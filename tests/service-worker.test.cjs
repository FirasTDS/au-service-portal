const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'..');
const scope = 'https://firastds.github.io/au-service-portal/';

function setup() {
    const events = {}, stored = new Map(), removed = [];
    let assets = [], fail = false;
    const cache = {async addAll(paths){assets = [...paths];},async put(url,response){stored.set(url,response);},async match(url){return stored.get(url);}};
    const context = vm.createContext({URL,Response,
        self:{registration:{scope},location:{origin:new URL(scope).origin},addEventListener:(name,fn)=>{events[name]=fn;},
            async skipWaiting(){},clients:{async claim(){}}},
        caches:{async open(){return cache;},async keys(){return ['unrelated-cache','au-portal-v1'];},async delete(key){removed.push(key);}},
        fetch:async()=>{if(fail)throw new Error('offline');return new Response('fresh');}
    });
    vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),context);
    return {events,stored,removed,get assets(){return assets;},offline(){fail=true;}};
}

test('manifest has a stable identity, scope, valid icons, and all precached assets exist', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
    assert.equal(manifest.id,manifest.start_url,'preserves the previously inferred install identity');
    assert.equal(manifest.scope,'./');
    assert.equal(manifest.display,'standalone');
    for(const icon of manifest.icons){
        const png = fs.readFileSync(path.join(root,icon.src));
        assert.equal(png.readUInt32BE(16),parseInt(icon.sizes));
        assert.equal(png.readUInt32BE(20),parseInt(icon.sizes));
    }
    const s=setup(); let done;
    s.events.install({waitUntil(promise){done=promise;}}); await done;
    for(const asset of s.assets) assert.ok(fs.existsSync(path.join(root,decodeURIComponent(asset))),asset);
    for(const essential of ['index.html','style.css','shared.js','data.json','manifest.json']) assert.ok(s.assets.includes(essential));
    assert.ok(!s.assets.some(asset=>/token|admin/i.test(asset)));
});

test('service worker serves the cached launch page offline, including query strings', async () => {
    const s=setup(); s.offline();
    s.stored.set(scope+'index.html',new Response('cached directory'));
    for(const url of [scope,scope+'?launch=1',scope+'index.html?v=49']){
        let result;
        s.events.fetch({request:{method:'GET',url},respondWith(promise){result=promise;}});
        assert.equal(await (await result).text(),'cached directory');
        s.stored.set(scope+'index.html',new Response('cached directory'));
    }
});

test('service worker refreshes assets online and bypasses forms, API calls and admin', async () => {
    const s=setup(); let result;
    s.events.fetch({request:{method:'GET',url:scope+'data.json?v=49'},respondWith(promise){result=promise;}});
    assert.equal(await (await result).text(),'fresh');
    assert.ok(s.stored.has(scope+'data.json'));
    for(const request of [{method:'POST',url:scope+'data.json'},{method:'GET',url:'https://docs.google.com/forms/'},
        {method:'GET',url:scope+'admin.html'},{method:'GET',url:'https://api.github.com/repos/test'}]){
        s.events.fetch({request,respondWith(){assert.fail('must not intercept '+request.url);}});
    }
});

test('activation removes only older portal caches', async () => {
    const s=setup();let done;
    s.events.activate({waitUntil(promise){done=promise;}});await done;
    assert.deepEqual(s.removed,['au-portal-v1']);
});
