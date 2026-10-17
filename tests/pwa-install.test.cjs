const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(navigator = {userAgent:'Mozilla/5.0 Android Chrome/140.0 Mobile Safari/537.36'}, standalone = false) {
    const events = {}, elements = {};
    const element = id => elements[id] ||= {style:{}, hidden:false, disabled:false,
        addEventListener(type, fn) { this[type] = fn; }, querySelector(){return {focus(){}};}, scrollIntoView(){}};
    const context = vm.createContext({
        navigator,
        window:{addEventListener(type, fn){events[type] = fn;},matchMedia(){return {matches:standalone,addEventListener(){}};}},
        document:{getElementById:element}, portalStorage:{get(){return null;},set(){}},
        showToast(){throw new Error('Prompt acceptance must not claim successful installation');}
    });
    const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
    vm.runInContext(html.slice(html.indexOf('    // --- PWA INSTALL PROMPT'),html.indexOf('    // Register Service Worker')),context);
    return {events,elements,context,click:()=>element('btnPwaInstall').click(),current:()=>context.installFromCurrentBrowser(true)};
}

test('accepted browser prompt offers help without claiming installation completed', async () => {
    const s = setup(); let calls = 0;
    s.events.beforeinstallprompt({preventDefault(){},async prompt(){calls++;},userChoice:Promise.resolve({outcome:'accepted'})});
    await s.click();
    assert.equal(calls,1);
    assert.equal(s.elements.installHelp.open,true);
    assert.equal(s.elements.btnPwaInstall.hidden,false);
    assert.match(s.elements.installProgress.textContent,/تم قبول طلب/);
    s.events.appinstalled();
    assert.equal(s.elements.pwaBanner.style.display,'none');
});

test('Samsung guides to Chrome but retains an explicit current-browser install option', async () => {
    const s = setup({userAgent:'Mozilla/5.0 Android SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36'});
    let calls = 0;
    s.events.beforeinstallprompt({preventDefault(){},async prompt(){calls++;},userChoice:Promise.resolve({outcome:'dismissed'})});
    await s.click();
    assert.equal(calls,0);
    assert.match(s.elements.installDeviceSteps.textContent,/Samsung Internet/);
    assert.equal(s.elements.installAndroidActions.hidden,false);
    assert.match(s.elements.installOpenChrome.href,/package=com.android.chrome/);
    assert.equal(s.elements.installCurrentBrowser.hidden,false);
    await s.current();
    assert.equal(calls,1);
    assert.equal(s.elements.installCurrentBrowser.hidden,true);
});

test('iPhone and desktop-mode iPad get install guidance without beforeinstallprompt', async () => {
    for (const navigator of [
        {userAgent:'Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1'},
        {userAgent:'Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1',maxTouchPoints:5},
        {userAgent:'Mozilla/5.0 (iPhone) CriOS/140.0 Mobile Safari/604.1'}
    ]) {
        const s = setup(navigator);
        s.events.DOMContentLoaded();
        assert.equal(s.elements.pwaBanner.style.display,'flex');
        await s.click();
        assert.equal(s.elements.installHelp.open,true);
        assert.match(s.elements.installDeviceSteps.textContent,/Safari/);
        assert.equal(s.elements.installAndroidActions.hidden,true);
    }
});

test('installed standalone apps do not advertise installation', () => {
    const s = setup(undefined,true);
    s.events.DOMContentLoaded();
    assert.equal(s.elements.pwaBanner.style.display,'none');
    assert.equal(s.elements.btnPwaInstall.hidden,true);
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

test('ordinary fullscreen mode must not hide installation', () => {
    const s = setup();
    s.context.window.matchMedia = query => ({matches:query === '(display-mode: fullscreen)'});
    s.events.DOMContentLoaded();
    assert.equal(s.elements.installCard.hidden, false);
    assert.equal(s.elements.btnPwaInstall.hidden, false);
});

test('embedded browsers show external-browser instructions without using a prompt', async () => {
    const s = setup({userAgent:'Mozilla/5.0 Android; wv) Chrome/140.0 Instagram'});
    let calls = 0;
    s.events.beforeinstallprompt({preventDefault(){},prompt(){calls++;}});
    await s.click();
    assert.equal(calls,0);
    assert.match(s.elements.installDeviceSteps.textContent,/الخارجي/);
});

test('an appinstalled event during prompt acceptance does not reopen help', async () => {
    const s = setup();
    s.events.beforeinstallprompt({preventDefault(){},async prompt(){s.events.appinstalled();},userChoice:Promise.resolve({outcome:'accepted'})});
    await s.click();
    assert.equal(s.elements.installCard.hidden,true);
    assert.notEqual(s.elements.installHelp?.open,true);
    assert.equal(s.elements.btnPwaInstall.disabled,false);
});
