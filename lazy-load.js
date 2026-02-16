// Lazy loading for external NHL player images only
(function() {
    'use strict';

    // Only lazy load large external images from NHL
    const LAZY_LOAD_DOMAINS = ['assets.nhle.com', 'nhl.bamcontent.com'];
    const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect fill="%23f0f0f0" width="100" height="100"/%3E%3C/svg%3E';

    let imageObserver = null;

    // Check if URL should be lazy loaded
    function shouldLazyLoad(url) {
        if (!url || url.startsWith('data:')) return false;
        return LAZY_LOAD_DOMAINS.some(domain => url.includes(domain));
    }

    // Initialize IntersectionObserver
    if ('IntersectionObserver' in window) {
        imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const realSrc = img.dataset.lazySrc;

                    if (realSrc) {
                        // Create a new image to preload
                        const tempImg = new Image();
                        tempImg.onload = function() {
                            img.src = realSrc;
                            img.removeAttribute('data-lazy-src');
                            img.classList.add('lazy-loaded');
                        };
                        tempImg.onerror = function() {
                            // If loading fails, still show something
                            img.src = realSrc;
                            img.removeAttribute('data-lazy-src');
                        };
                        tempImg.src = realSrc;

                        imageObserver.unobserve(img);
                    }
                }
            });
        }, {
            rootMargin: '200px 0px', // Start loading 200px before visible
            threshold: 0.01
        });
    }

    // Process an image for lazy loading
    function processImage(img) {
        if (!img || !img.src) return;
        if (img.hasAttribute('data-no-lazy')) return;
        if (img.hasAttribute('data-lazy-processed')) return;

        const src = img.src;

        if (shouldLazyLoad(src)) {
            img.setAttribute('data-lazy-processed', 'true');
            img.setAttribute('data-lazy-src', src);
            img.src = PLACEHOLDER;

            if (imageObserver) {
                imageObserver.observe(img);
            } else {
                // Fallback: load immediately
                img.src = src;
            }
        }
    }

    // Process all images on the page
    function processAllImages() {
        document.querySelectorAll('img').forEach(img => {
            processImage(img);
        });
    }

    // Watch for dynamically added images
    if ('MutationObserver' in window) {
        const mutationObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Element node
                        if (node.tagName === 'IMG') {
                            // Small delay to ensure src is set
                            setTimeout(() => processImage(node), 10);
                        } else if (node.querySelectorAll) {
                            node.querySelectorAll('img').forEach(img => {
                                setTimeout(() => processImage(img), 10);
                            });
                        }
                    }
                });
            });
        });

        // Start observing after DOM is ready
        function startObserving() {
            if (document.body) {
                mutationObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startObserving);
        } else {
            startObserving();
        }
    }

    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', processAllImages);
    } else {
        processAllImages();
    }

    // Also process images shortly after to catch any late additions
    setTimeout(processAllImages, 500);
    setTimeout(processAllImages, 1500);

    // Expose function for manual triggering
    window.lazyLoadImages = processAllImages;
})();
