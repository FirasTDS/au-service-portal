const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const shared = read('shared.js');
const helpers = shared.slice(shared.indexOf('function normalizeContactInput('), shared.indexOf('function validatePortalData('));
const context = vm.createContext({ URL });
vm.runInContext(helpers, context);
const parse = context.normalizeContactInput;

test('all supplied formats normalize without losing a second number', () => {
    const examples = [
        ['0988255711', '0988255711'],
        ['0995787906 0990351968', '0995787906 / 0990351968'],
        ['+963 981 152 482', '0981152482'],
        ['+963 939 534 001', '0939534001'],
        ['0933 574 279', '0933574279'],
        ['0935 535 329', '0935535329'],
        ['0932636768', '0932636768'],
        ['0949071072', '0949071072'],
        ['+963951339026', '0951339026'],
        ['+963994207644', '0994207644'],
        ['00963 (981) 152-482 / 0981152482', '0981152482'],
        ['٠٩٩٥٧٨٧٩٠٦، ۰۹۹۰۳۵۱۹۶۸', '0995787906 / 0990351968'],
        ['988255711', '0988255711'],
        ['043-7557333', '0437557333'],
        ['133', '133']
    ];
    for (const [input, expected] of examples) {
        assert.equal(parse(input).error, '', input);
        assert.equal(parse(input).value, expected, input);
    }
});

test('incomplete or ambiguous values never produce partial dial links', () => {
    for (const input of ['', '098825571', '0995787906 12345', '+963 981 152', 'hello', 'javascript:alert(1)']) {
        assert.ok(parse(input).error, input);
        assert.equal(parse(input).phones.length, 0, input);
    }
});

test('links stay links and only Syrian mobile numbers get WhatsApp', () => {
    assert.equal(parse('t.me/studentandalus').link, 'https://t.me/studentandalus');
    assert.equal(parse('https://example.com/?a=1&b=2').phones.length, 0);
    assert.equal(context.whatsappUrl('0981152482'), 'https://wa.me/963981152482');
    assert.equal(context.whatsappUrl('0437557333'), '');
    assert.equal(context.whatsappUrl('133'), '');
});

test('legacy two-number entry renders separate call and WhatsApp actions', () => {
    const index = read('index.html');
    const ctx = vm.createContext({ URL, escapeHtml: value => String(value || ''), sanitizeUrl: value => value,
        createStarsHtml: () => '', getLocalFavorites: () => [] });
    vm.runInContext(helpers, ctx);
    vm.runInContext(index.slice(index.indexOf('    function createContactRow('), index.indexOf('    // --- SORT HELPER')), ctx);
    const html = ctx.createContactRow({ name: 'Test', phone: '0995787906 +963 990 351 968' });
    assert.deepEqual([...html.matchAll(/href="tel:([^"]+)"/g)].map(match => match[1]), ['0995787906', '0990351968']);
    assert.deepEqual([...html.matchAll(/href="https:\/\/wa.me\/([^"]+)"/g)].map(match => match[1]), ['963995787906', '963990351968']);
    assert.equal((ctx.createContactRow({ name: 'Test', phone: '0995787906 12345' }).match(/href="tel:/g) || []).length, 0);
});

test('duplicate detection matches formatting and order but preserves new second numbers', () => {
    const admin = read('admin.html');
    const ctx = vm.createContext({ URL, adminData: { services: { taxis: [{ name: 'Test', phone: '0995787906 / 0990351968' }] }, transport: [] } });
    vm.runInContext(helpers, ctx);
    vm.runInContext(admin.slice(admin.indexOf('        function checkItemExists('), admin.indexOf('        // Approve and automatically')), ctx);
    assert.equal(ctx.checkItemExists('Test', '+963990351968 0995787906'), true);
    assert.equal(ctx.checkItemExists('Test', '+963995787906'), true);
    assert.equal(ctx.checkItemExists('Test', '0995787906 / 0988255711'), false);
});

test('existing directory numbers remain supported and page scripts compile', () => {
    const data = JSON.parse(read('data.json'));
    const items = [...Object.values(data.services).flat(), ...data.transport.flatMap(group => group.items), ...data.pharmacies_duty.schedule];
    for (const item of items) assert.equal(parse(item.phone || item.link).error, '', item.phone || item.link);
    for (const file of ['index.html', 'admin.html']) {
        for (const script of read(file).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
    }
});
