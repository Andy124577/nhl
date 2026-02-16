// Aggressive lazy loading for all images
(function() {
    'use strict';

    // Configuration
    const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"%3E%3Crect fill="%23ddd" width="200" height="200"/%3E%3C/svg%3E';

    let imageObserver = null;

    // Initialize IntersectionObserver
    if ('IntersectionObserver' in window) {
        imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const realSrc = img.dataset.src || img.dataset.lazySrc;

                    if (realSrc && realSrc !== img.src) {
                        img.src = realSrc;
                        img.removeAttribute('data-src');
                        img.removeAttribute('data-lazy-src');
                        img.classList.add('lazy-loaded');
                        imageObserver.unobserve(img);
                    }
                }
            });
        }, {
            rootMargin: '100px 0px', // Start loading 100px before element is visible
            threshold: 0.01
        });
    }

    // Function to lazy load an image
    function lazyLoadImage(img) {
        if (!img || img.hasAttribute('data-lazy-initialized')) return;

        const src = img.src || img.getAttribute('src');
        if (!src || src === PLACEHOLDER || src.startsWith('data:')) return;

        // Mark as initialized
        img.setAttribute('data-lazy-initialized', 'true');

        // Store real src and set placeholder
        img.setAttribute('data-src', src);
        img.src = PLACEHOLDER;

        // Observe with IntersectionObserver
        if (imageObserver) {
            imageObserver.observe(img);
        } else {
            // Fallback: load immediately
            img.src = src;
        }
    }

    // Intercept Image src property setter
    if (typeof Image !== 'undefined') {
        const OriginalImage = Image;
        const ImageDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        const originalSrcSetter = ImageDescriptor.set;

        ImageDescriptor.set = function(value) {
            if (value && !value.startsWith('data:') && !this.hasAttribute('data-no-lazy')) {
                this.setAttribute('data-src', value);
                originalSrcSetter.call(this, PLACEHOLDER);

                if (imageObserver) {
                    imageObserver.observe(this);
                } else {
                    originalSrcSetter.call(this, value);
                }
            } else {
                originalSrcSetter.call(this, value);
            }
        };

        Object.defineProperty(HTMLImageElement.prototype, 'src', ImageDescriptor);
    }

    // Observe all existing images
    function observeExistingImages() {
        document.querySelectorAll('img').forEach(img => {
            lazyLoadImage(img);
        });
    }

    // Watch for new images being added to the DOM
    if ('MutationObserver' in window) {
        const mutationObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.tagName === 'IMG') {
                        lazyLoadImage(node);
                    } else if (node.querySelectorAll) {
                        node.querySelectorAll('img').forEach(img => lazyLoadImage(img));
                    }
                });
            });
        });

        mutationObserver.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeExistingImages);
    } else {
        observeExistingImages();
    }

    // Expose global function for manual triggering
    window.lazyLoadImages = observeExistingImages;
})();
