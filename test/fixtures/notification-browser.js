'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A small DOM/event/clock double lets the actual page script run from startup.
// It deliberately does not implement layout, CSS, navigation, or accessibility
// APIs: those require a browser check, rather than assertions against this double.
const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

class EventTarget {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback) {
        const list = this.listeners.get(type) || [];
        list.push(callback);
        this.listeners.set(type, list);
    }
    removeEventListener(type, callback) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter(fn => fn !== callback));
    }
    dispatchEvent(event) {
        event.target ||= this;
        event.currentTarget = this;
        event.preventDefault ||= () => { event.defaultPrevented = true; };
        event.stopPropagation ||= () => { event.stopped = true; };
        for (const fn of this.listeners.get(event.type) || []) fn.call(this, event);
        if (event.bubbles !== false && !event.stopped && this.parentNode) {
            this.parentNode.dispatchEvent(event);
        }
        return !event.defaultPrevented;
    }
}

class Element extends EventTarget {
    constructor(tag, document) {
        super();
        this.tagName = tag.toUpperCase();
        this.ownerDocument = document;
        this.children = [];
        this.attributes = {};
        this.dataset = {};
        this.style = {};
        this._text = '';
        this.classList = {
            contains: token => this.className.split(/\s+/).includes(token),
            add: (...tokens) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...tokens])].join(' '); },
            remove: (...tokens) => { this.className = this.className.split(/\s+/).filter(token => !tokens.includes(token)).join(' '); },
            toggle: (token, force) => {
                const enabled = force ?? !this.classList.contains(token);
                this.classList[enabled ? 'add' : 'remove'](token);
                return enabled;
            }
        };
    }
    get id() { return this.attributes.id || ''; }
    set id(value) { this.setAttribute('id', value); }
    get className() { return this.attributes.class || ''; }
    set className(value) { this.setAttribute('class', value); }
    get hidden() { return 'hidden' in this.attributes; }
    set hidden(value) { value ? this.setAttribute('hidden', '') : this.removeAttribute('hidden'); }
    get disabled() { return 'disabled' in this.attributes; }
    set disabled(value) { value ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'); }
    get href() { return this.getAttribute('href'); }
    set href(value) { this.setAttribute('href', value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    set innerHTML(html) { this.children = []; this._text = ''; parseHTML(String(html), this); }
    get innerHTML() { return this.children.map(child => child.outerHTML).join(''); }
    get outerHTML() {
        const attrs = Object.entries(this.attributes).map(([key, value]) => ` ${key}="${value}"`).join('');
        return `<${this.tagName.toLowerCase()}${attrs}>${this._text}${this.innerHTML}</${this.tagName.toLowerCase()}>`;
    }
    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    hasAttribute(name) { return name in this.attributes; }
    removeAttribute(name) { delete this.attributes[name]; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    append(...children) { for (const child of children) this.appendChild(child); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    insertAdjacentHTML(position, html) {
        const fragment = new Element('fragment', this.ownerDocument);
        parseHTML(html, fragment);
        fragment.children.forEach(child => { child.parentNode = this; });
        this.children = position === 'afterbegin' ? [...fragment.children, ...this.children] : [...this.children, ...fragment.children];
    }
    matches(selector) {
        return selector.split(',').some(part => {
            const query = part.trim();
            const tag = query.match(/^[a-z][\w-]*/i)?.[0];
            if (tag && this.tagName !== tag.toUpperCase()) return false;
            const id = query.match(/#([\w-]+)/)?.[1];
            if (id && this.id !== id) return false;
            for (const match of query.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(match[1])) return false;
            for (const match of query.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
                if (!this.hasAttribute(match[1])) return false;
                if (match[2] !== undefined && this.getAttribute(match[1]) !== match[2]) return false;
            }
            return true;
        });
    }
    closest(selector) {
        for (let node = this; node instanceof Element; node = node.parentNode) if (node.matches(selector)) return node;
        return null;
    }
    contains(other) {
        for (let node = other; node; node = node.parentNode) if (node === this) return true;
        return false;
    }
    querySelectorAll(selector) {
        const parts = selector.trim().split(/\s+/);
        const found = [];
        const visit = node => {
            for (const child of node.children) {
                if (child.matches(parts.at(-1))) {
                    let ancestor = child.parentNode;
                    let index = parts.length - 2;
                    while (index >= 0 && ancestor instanceof Element) {
                        if (ancestor.matches(parts[index])) index--;
                        ancestor = ancestor.parentNode;
                    }
                    if (index < 0) found.push(child);
                }
                visit(child);
            }
        };
        visit(this);
        return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() {
        const previous = this.ownerDocument.activeElement;
        if (previous === this) return;
        previous?.dispatchEvent({ type: 'focusout', bubbles: true, relatedTarget: this });
        this.ownerDocument.activeElement = this;
        this.dispatchEvent({ type: 'focusin', bubbles: true, relatedTarget: previous });
    }
    click() { if (!this.disabled) this.dispatchEvent({ type: 'click', button: 0, bubbles: true }); }
}

function parseHTML(html, parent) {
    const stack = [parent];
    for (const token of html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith('<!--')) continue;
        if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
        if (!token.startsWith('<')) { stack.at(-1)._text += decode(token); continue; }
        const tag = token.match(/^<([\w-]+)/)?.[1];
        if (!tag) continue;
        const element = new Element(tag, parent.ownerDocument);
        const attributes = token.slice(tag.length + 1).replace(/\/?\s*>$/, '');
        for (const match of attributes.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
            element.setAttribute(match[1], decode(match[2] ?? match[3] ?? match[4] ?? ''));
        }
        stack.at(-1).appendChild(element);
        if (!token.endsWith('/>') && !/^(?:input|br|hr|img|meta|link)$/i.test(tag)) stack.push(element);
    }
}

async function createNotificationBrowser(options = {}) {
    const storage = options.storage || new Map();
    const username = options.username || 'Alice';
    storage.set('username', username);
    storage.set('isLoggedIn', 'true');
    const document = new EventTarget();
    document.readyState = 'complete';
    document.visibilityState = 'visible';
    document.hidden = false;
    document.body = new Element('body', document);
    document.body.parentNode = document;
    document.documentElement = document.body;
    document.activeElement = document.body;
    document.querySelectorAll = selector => document.body.querySelectorAll(selector);
    document.querySelector = selector => document.body.querySelector(selector);
    document.getElementById = id => document.querySelector(`#${id}`);
    document.createElement = tag => new Element(tag, document);
    document.body.innerHTML = '<nav class="navbar"><div class="navbar-desktop"><div class="navbar-right"></div></div></nav>';

    let now = Date.parse('2026-09-06T16:00:00Z');
    let timerId = 0;
    const timers = new Map();
    const schedule = (callback, delay = 0, interval = false) => {
        const id = ++timerId;
        timers.set(id, { callback, due: now + Number(delay), interval: interval ? Number(delay) : 0 });
        return id;
    };
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const advance = async milliseconds => {
        const end = now + milliseconds;
        for (let count = 0; count < 1000; count++) {
            const entry = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
            if (!entry) { now = end; await flush(); return; }
            const [id, timer] = entry;
            now = timer.due;
            timers.delete(id);
            if (timer.interval) timers.set(id, { ...timer, due: now + timer.interval });
            timer.callback();
            await flush();
        }
        throw new Error('Notification clock exceeded 1,000 callbacks');
    };

    let trades = options.trades || [];
    let pools = options.pools || [];
    let fetchFailure = false;
    let deferredFetch = null;
    const sockets = new Map();
    const dataListeners = [];
    const requests = [];
    const socket = { on: (type, callback) => { const list = sockets.get(type) || []; list.push(callback); sockets.set(type, list); } };
    const window = new EventTarget();
    window.location = new URL('http://localhost:3000/index.html');
    window.__fzSocketPool = socket;
    window.FZPool = {
        BASE_URL: 'http://localhost:3000', ready: async () => {},
        mine: () => pools, draftState: data => data, onData: callback => dataListeners.push(callback),
        refresh: async () => { for (const callback of dataListeners) callback(); }
    };
    const localStorage = {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => { if (options.storageFailure) throw new Error('Storage unavailable'); storage.set(key, String(value)); },
        removeItem: key => storage.delete(key)
    };
    const context = {
        window, document, localStorage, FZPool: window.FZPool,
        io: () => socket, Date: ClockDate, URL, URLSearchParams, Intl, console,
        AbortSignal: { timeout: () => new AbortController().signal },
        setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => timers.delete(id),
        setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: id => timers.delete(id),
        requestAnimationFrame: fn => schedule(fn, 16),
        MutationObserver: class { observe() {} disconnect() {} },
        fetch: async url => {
            requests.push(String(url));
            if (deferredFetch) {
                const pending = deferredFetch;
                deferredFetch = null;
                return pending;
            }
            if (fetchFailure) throw new Error('Offline');
            return { ok: true, json: async () => JSON.parse(JSON.stringify(trades)) };
        }
    };
    Object.assign(window, { localStorage, setTimeout: context.setTimeout, clearTimeout: context.clearTimeout });
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../notifications.js'), 'utf8'), context, { filename: 'notifications.js' });
    await flush();
    await advance(1000);

    return {
        document, window, storage, requests, flush, advance,
        element: id => document.getElementById(id),
        items: () => document.getElementById('fzNotifList').querySelectorAll('a[data-notification-id]'),
        state: () => JSON.parse(storage.get(`fzNotifications:v1:${encodeURIComponent(username)}`) || 'null'),
        setTrades: value => { trades = value; },
        setPools: value => { pools = value; },
        failFetch: () => { fetchFailure = true; },
        holdNextFetch: () => {
            let release;
            deferredFetch = new Promise(resolve => { release = value => resolve({ ok: true, json: async () => JSON.parse(JSON.stringify(value)) }); });
            return release;
        },
        emit: async (type, payload) => { for (const callback of sockets.get(type) || []) callback(payload); await flush(); await advance(1000); },
        updatePools: async () => { for (const callback of dataListeners) callback(); await flush(); await advance(1000); },
        dispatch: (target, type, extra = {}) => target.dispatchEvent({ type, bubbles: true, ...extra })
    };
}

module.exports = { createNotificationBrowser };
