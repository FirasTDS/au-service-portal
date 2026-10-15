const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
    const events = {}, elements = {};
    const element = id => elements[id] ||= {style:{}, hidden:false, disabled:false,
        addEventListener(type, fn) { this[type] = fn; }, querySelector(){return {focus(){}};}, scrollIntoView(){}};
    const context = vm.createContext({
        window:{addEventListener(type, fn){events[type] = fn;}},
        document:{getElementById:element}, portalStorage:{get(){return null;},set(){}},
        showToast(){throw new Error('Prompt acceptance must not claim successful installation');}
    });
    const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
    vm.runInContext(html.slice(html.indexOf('    // --- PWA INSTALL PROMPT'),html.indexOf('    // Register Service Worker')),context);
    return {events,elements,click:()=>element('btnPwaInstall').click()};
}

test('accepted browser prompt offers help without claiming installation completed', async () => {
    const s = setup(); let calls = 0;
    s.events.beforeinstallprompt({preventDefault(){},async prompt(){calls++;},userChoice:Promise.resolve({outcome:'accepted'})});
    await s.click();
    assert.equal(calls,1);
    assert.equal(s.elements.installHelp.open,true);
    assert.equal(s.elements.btnPwaInstall.hidden,true);
    assert.match(s.elements.installProgress.textContent,/تم قبول طلب/);
    s.events.appinstalled();
    assert.equal(s.elements.pwaBanner.style.display,'none');
});

test('failed or unavailable prompts show fallback instructions and release button', async () => {
    const s = setup();
    s.events.beforeinstallprompt({preventDefault(){},async prompt(){throw new Error('Blocked');}});
    await s.click();
    assert.equal(s.elements.btnPwaInstall.disabled,false);
    assert.match(s.elements.installProgress.textContent,/تعذر/);
    await s.click();
    assert.match(s.elements.installProgress.textContent,/غير متاح/);
});

test('double click cannot reuse a one-shot installation prompt', async () => {
    const s = setup(); let calls = 0, resolve;
    s.events.beforeinstallprompt({preventDefault(){},async prompt(){calls++;},userChoice:new Promise(r=>resolve=r)});
    const first = s.click();
    await s.click();
    resolve({outcome:'dismissed'});
    await first;
    assert.equal(calls,1);
    assert.equal(s.elements.btnPwaInstall.disabled,false);
});
