// The small script and styles of trails (A4): the peek card on a topic link, the keys, and the look of the trail line, the previous/next bar and the neighbours strip.
// The script is served from this site (/viz/keys.js; the page policy allows no inline script) and adds to pages that work without it: a link is still a link, and the keys are shortcuts for links already there.

export const KEYS_JS = `(function(){var d=document,tip=null,timer=0,cur=null,seen={},held=null,gAt=0,help=null;
function typing(t){var n=t&&t.tagName;return n==='INPUT'||n==='TEXTAREA'||n==='SELECT'||!!(t&&t.isContentEditable)}
function topicOf(a){if(!a||!a.href||(a.closest&&a.closest('#peek')))return null;var u;try{u=new URL(a.href,location.href)}catch(e){return null}
if(u.origin!==location.origin)return null;var m=/^\\/t\\/([a-z0-9][a-z0-9-]{0,63})$/.exec(u.pathname);return m?{slug:m[1],area:u.searchParams.get('area')==='politics'?'politics':''}:null}
function mk(){var e=d.createElement('div');e.id='peek';e.className='peek';e.setAttribute('role','tooltip');e.hidden=true;d.body.appendChild(e);return e}
function hide(){clearTimeout(timer);cur=null;if(tip)tip.hidden=true}
function place(a){var r=a.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight,x=Math.max(8,Math.min(r.left,innerWidth-w-8)),y=r.bottom+6;if(y+h>innerHeight-8&&r.top-h-6>8)y=r.top-h-6;tip.style.left=x+'px';tip.style.top=y+'px'}
function show(a,t){var k=t.slug+'|'+t.area;function put(h){if(cur!==a||!h)return;tip=tip||mk();tip.innerHTML=h;tip.hidden=false;place(a)}
if(k in seen){put(seen[k]);return}
fetch('/t/'+t.slug+'/peek'+(t.area?'?area=politics':''),{credentials:'omit'}).then(function(r){return r.ok?r.text():''}).then(function(h){seen[k]=h;put(h)}).catch(function(){})}
function arm(a,ms,touch){var t=topicOf(a);if(!t)return;hide();cur=a;timer=setTimeout(function(){if(touch)held=a;show(a,t)},ms)}
d.addEventListener('mouseover',function(e){if(e.sourceCapabilities&&e.sourceCapabilities.firesTouchEvents)return;var a=e.target.closest&&e.target.closest('a');if(a===cur)return;if(!a){hide();return}arm(a,350,false)});
d.addEventListener('mouseout',function(e){var a=e.target.closest&&e.target.closest('a');if(a&&a===cur&&!(e.relatedTarget&&a.contains(e.relatedTarget)))hide()});
d.addEventListener('touchstart',function(e){var a=e.target.closest&&e.target.closest('a');if(!a||a!==cur)hide();if(a)arm(a,550,true)},{passive:true});
['touchmove','touchend','touchcancel'].forEach(function(n){d.addEventListener(n,function(){clearTimeout(timer)},{passive:true})});
d.addEventListener('contextmenu',function(e){if(held&&e.target.closest&&e.target.closest('a')===held)e.preventDefault()});
d.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a');if(held&&a===held){e.preventDefault();held=null;return}held=null;hide()},true);
addEventListener('scroll',hide,{passive:true});addEventListener('blur',hide);
function items(){return Array.prototype.filter.call(d.querySelectorAll('main .sgitems>li,main .papers>li,main .lrows>li,main .brief>li,main .azl>li,main .ncards>li'),function(x){return x.offsetParent!==null})}
function move(n){var l=items(),i=-1,k;for(k=0;k<l.length;k++)if(l[k].contains(d.activeElement)){i=k;break}
i=Math.max(0,Math.min(l.length-1,i<0?(n>0?0:l.length-1):i+n));var a=l[i]&&l[i].querySelector('a[href]');if(a)a.focus()}
function go(a){if(a&&a.href)location.href=a.href}
function panel(show){if(!help){help=d.createElement('div');help.id='keyhelp';help.className='keyhelp';help.setAttribute('role','dialog');help.setAttribute('aria-label','Keyboard shortcuts');help.hidden=true;
help.innerHTML='<h2>Keyboard</h2><dl><dt>/</dt><dd>Search</dd><dt>j  k</dt><dd>Next, previous in the list</dd><dt>[  ]</dt><dd>Previous, next topic</dd><dt>1 to 5</dt><dd>Angle of a topic</dd><dt>g l</dt><dd>The landscape</dd><dt>?</dt><dd>This list</dd><dt>Esc</dt><dd>Close</dd></dl>';
help.addEventListener('click',function(){help.hidden=true});d.body.appendChild(help)}
help.hidden=show===undefined?!help.hidden:!show}
d.addEventListener('keydown',function(e){if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return;
if(e.key==='Escape'){hide();if(help)help.hidden=true;return}
if(typing(e.target))return;var k=e.key;
if(gAt&&Date.now()-gAt<1200){gAt=0;if(k==='l'){e.preventDefault();go(d.querySelector('a.brand'))}return}
if(k==='g'){gAt=Date.now();return}
if(k==='/'){var i=d.querySelector('.topbar input[type=search]')||d.querySelector('input[type=search]');if(i){e.preventDefault();i.focus();if(i.select)i.select()}}
else if(k==='j'||k==='k'){move(k==='j'?1:-1)}
else if(k==='['||k===']'){go(d.querySelector('.trailnav a[rel='+(k==='['?'prev':'next')+']'))}
else if(k>='1'&&k<='5'){go(d.querySelectorAll('nav[aria-label="Angles on this topic"] a')[+k-1])}
else if(k==='?'){panel()}})})();`;

export const TRAIL_CSS = `
.trail{margin:0 0 14px;font-size:13.5px;color:var(--muted)}.trail ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:2px 0}
.trail li{display:inline-flex;align-items:baseline;min-width:0}.trail li+li::before{content:'\\203A';margin:0 7px;color:var(--muted);opacity:.7}
.trail a{color:var(--muted);text-decoration:none;border-bottom:1px solid transparent}.trail a:hover,.trail a:focus-visible{color:var(--text);border-bottom-color:currentColor}
.trail [aria-current=page]{color:var(--text);font-weight:600;overflow-wrap:anywhere}.trail .tl-lens a{font-weight:600}
.trailnav{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 14px;margin:0 0 18px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);font-size:14px}
.trailnav a{color:var(--text);text-decoration:none;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.trailnav a:hover{color:var(--accent)}.trailnav .pos{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.trailnav .none{max-width:42%;color:var(--muted);opacity:.6}
.ncards{list-style:none;margin:0 0 12px;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.ncard,.peekcard{border:1px solid var(--line);border-top:3px solid var(--line);border-radius:12px;background:var(--card);padding:12px 14px;box-shadow:var(--sh1);min-width:0}
.ncard.st-rising,.peekcard.st-rising{border-top-color:var(--accent)}.ncard.st-new,.peekcard.st-new{border-top-color:var(--amber)}
.ncard h3,.peekcard h3{margin:0;font-size:15.5px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}.ncard h3 a{color:var(--text);text-decoration:none}.ncard h3 a:hover{color:var(--accent)}
.ncard p,.peekcard p{margin:6px 0 4px;font-size:13.5px;color:var(--muted);overflow-wrap:anywhere}.ncard svg,.peekcard svg{display:block;width:100%;height:36px}
.peek{position:fixed;z-index:60;width:min(300px,calc(100vw - 16px));pointer-events:none}.peek[hidden]{display:none}.peek .peekcard{box-shadow:var(--sh2)}
@media(prefers-reduced-motion:no-preference){.peek:not([hidden]){animation:peekin .12s ease-out}@keyframes peekin{from{opacity:0}}}
.keyhelp{position:fixed;z-index:70;right:16px;bottom:16px;width:min(280px,calc(100vw - 32px));padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--text);box-shadow:var(--sh2)}.keyhelp[hidden]{display:none}
.keyhelp h2{margin:0 0 8px;font-size:15px}.keyhelp dl{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0;font-size:13.5px}.keyhelp dt{font-family:ui-monospace,monospace;font-weight:700;white-space:pre}.keyhelp dd{margin:0;color:var(--muted)}
`;
