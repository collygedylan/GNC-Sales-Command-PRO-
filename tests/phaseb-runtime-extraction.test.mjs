import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cardOwners,cardExtractionFixture,normalizedCardDigest,assertCanonicalEvidenceExtraction,assertPublicationBranchExtraction} from './helpers/phaseb-runtime-extraction-contract.mjs';

// Normalized markup captured from the 0803a2ca legacy owner before extraction.
const expected = {
    drive:['b26c26a81284a927','5498f0d661004b99'], av:['31c3b8b8a96d0a7b','29f599d2e9a339c2'],
    'av-photo':['dde2b7b18762153b','a2b6925b6a2672fd'], request:['024438d55b786fd6','cb979f0e6a82601d'],
    docks:['c09779c94085d3cb','41f8cee004e52e61'], 'eval-work':['6b08fb674e911f44','2166228a5e0de461'],
    'sales-office-order':['91c2ae89b980b308','1f059780b1f57cf7'], 'sales-office':['0702bc70993f02f4','7a8e3f5800652466'],
    reserves_drill:['89eb196e637dab00','beca43126bf3c2fc'], 'crop-roll':['a4a1a691b66e997c','de2a5cc98dd9950b'],
    tasks:['c9e45f27752e47c7','2d21b8c33a07797b'], other:['ef1a689f696ecda2','c602b0c01fa85787'],
};

test('extracted card owners retain legacy markup across twelve callers and both photo states', () => {
    for (const [view,digests] of Object.entries(expected)) for (const [index,photo] of [false,true].entries()) {
        const fixture = cardExtractionFixture(undefined,{photo});
        const html = fixture.context.generateCard(fixture.item,view);
        assert.equal(normalizedCardDigest(html).slice(0,16),digests[index],view+' photo='+photo);
        if (['drive','av','av-photo','eval-work'].includes(view)) assert.equal(fixture.calls[0][0],'canonical');
    }
});

test('AV kiosk presentation retains canonical stored stock while excluding location chrome', () => {
    const fixture = cardExtractionFixture(undefined,{photo:true,kiosk:true});
    const before = JSON.stringify(fixture.item), html = fixture.context.generateCard(fixture.item,'av');
    assert.doesNotMatch(html,/Location A\.01|data-quantity/);
    assert.match(html,/Published note/);assert.match(html,/https:\/\/fixture\.example\/one\.jpg/);
    assert.equal(JSON.stringify(fixture.item),before);assert.equal(fixture.master.PTRONHAND,7);
});

test('classic card assets are exact projections of their focused source owners', () => {
    for (const name of [...cardOwners,'canonical-inventory-evidence','row-publication-branches']) {
        const directory = cardOwners.includes(name)?'views':'engine';
        const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
        const source = read('src/'+directory+'/'+name+'.js');
        assert.ok(source.trimEnd().split('\n').length < 400);
        assert.equal(read('assets/'+name+'.js'),source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''));
    }
});

test('canonical evidence retains account scope, stock zeros, depletion and ten-day retention',assertCanonicalEvidenceExtraction);
test('publication branches retain exact Request and Season receipts and rollback fences',assertPublicationBranchExtraction);
