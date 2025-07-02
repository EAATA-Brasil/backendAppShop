// CSS Loader with performance optimization
(function() {
  // CSS loaded tracking
  const loadedCSS = new Set();
  
  // Load CSS asynchronously with print-then-all pattern
  function loadCSS(href) {
    if (loadedCSS.has(href)) return;
    loadedCSS.add(href);
    
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.media = 'print';
    document.head.appendChild(link);
    
    // Once it's loaded, change media to all
    link.onload = function() {
      link.media = 'all';
    };
    
    return link;
  }

  // Load dynamic CSS bundle with specific selectors
  function loadDynamicCSS(selectors) {
    if (!selectors || !selectors.length) return;
    
    const queryString = selectors.join(',');
    const cacheKey = `/css/dynamic-bundle?selectors=${queryString}`;
    
    loadCSS(cacheKey);
  }

  // Main CSS loading function
  function loadCSSChunks() {
    // Load initial non-critical CSS chunk
    loadCSS('/css/non-critical.css');
    
    // Detect components/sections and load CSS on demand
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const section = entry.target.getAttribute('data-section');
          const selectors = entry.target.getAttribute('data-css-selectors');
          
          if (selectors) {
            // Load dynamic CSS bundle for this component
            loadDynamicCSS(selectors.split(','));
            observer.unobserve(entry.target);
          } else if (section) {
            // Load predefined chunk for this section
            loadCSS(`/css/chunk-${section}.css`);
            observer.unobserve(entry.target);
          }
        }
      });
    }, {
      rootMargin: '200px', // Load CSS before element is visible
      threshold: 0
    });
    
    // Observe all sections
    document.querySelectorAll('[data-section], [data-css-selectors]').forEach(section => {
      observer.observe(section);
    });
  }
  
  // Execute when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadCSSChunks);
  } else {
    loadCSSChunks();
  }
})();