// Google Analytics (gtag) init. Se mantiene fuera del HTML para no requerir
// 'unsafe-inline' en la CSP: se sirve desde 'self'.
window.dataLayer = window.dataLayer || [];
function gtag() {
  dataLayer.push(arguments);
}
gtag('js', new Date());
gtag('config', 'G-CK4JP1LXQB');
