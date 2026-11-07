import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackRecipeToolActivity } from '../chat-recipe-activity.ts';

function fixture() {
    const records = [], captured = [];
    const store = {
        recordRecipeActivity: (turn, id, activity) => records.push({ turn, id, activity }),
        captureRecipeActivity: (turn, id) => {
            captured.push(id);
            if (id === 'unowned') throw new Error('Recipe not found');
            return activity => records.push({ turn, id, activity });
        },
    };
    const execute = (name, args, data, isError = false) => trackRecipeToolActivity(store, 'turn', name, args, async () => ({
        isError, content: [{ type: 'text', text: JSON.stringify(data) }],
    }));
    return { records, captured, execute, store };
}

test('actual returned relation target wins over selected/model supplied recipe', async () => {
    const f = fixture();
    await f.execute('update_hop_in_recipe', { recipe_id: 'preview', recipe_hop_id: 'hop' }, { success: true, recipe_id: 'actual' });
    assert.deepEqual(f.records, [{ turn: 'turn', id: 'actual', activity: 'modified' }]);
});

test('clone records the source as read and new recipe as modified', async () => {
    const f = fixture();
    await f.execute('clone_recipe', { recipe_id: 'source' }, { success: true, recipe: { id: 'clone' } });
    assert.deepEqual(f.records, [
        { turn: 'turn', id: 'source', activity: 'read' }, { turn: 'turn', id: 'clone', activity: 'modified' },
    ]);
});

test('read/search results associate only recipes actually returned by the core', async () => {
    const f = fixture();
    await f.execute('get_recipe_by_id', { recipe_id: 'requested' }, { recipe: { id: 'returned' } });
    await f.execute('search_recipes', {}, { recipes: [{ id: 'one' }, { id: 'two' }] });
    await f.execute('search_hops', {}, { hops: [{ id: 'catalog' }] });
    assert.deepEqual(f.records.map(row => [row.id, row.activity]), [['returned', 'read'], ['one', 'read'], ['two', 'read']]);
});

test('failed operations cannot claim read or modified activity', async () => {
    const f = fixture();
    await f.execute('update_recipe', {}, { success: false, recipe: { id: 'failed' } });
    await f.execute('get_recipe_by_id', {}, { recipe: { id: 'failed' } }, true);
    assert.deepEqual(f.records, []);
});

test('delete validates and captures before execution but records only after success', async () => {
    const f = fixture();
    await trackRecipeToolActivity(f.store, 'turn', 'delete_recipe', { recipe_id: 'owned' }, async () => {
        assert.deepEqual(f.captured, ['owned']);
        assert.deepEqual(f.records, []);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, deleted_recipe_id: 'owned' }) }] };
    });
    assert.deepEqual(f.records, [{ turn: 'turn', id: 'owned', activity: 'modified' }]);
    await f.execute('delete_recipe', { recipe_id: 'owned' }, { success: false });
    assert.equal(f.records.length, 1);
    let executed = false;
    await assert.rejects(trackRecipeToolActivity(f.store, 'turn', 'delete_recipe', { recipe_id: 'unowned' }, async () => { executed = true; return { content: [] }; }), /not found/);
    assert.equal(executed, false);
});

test('metadata failures preserve committed mutation success without disclosing error details', async (t) => {
    const warnings = [];
    t.mock.method(console, 'warn', message => warnings.push(message));
    const store = {
        recordRecipeActivity: () => { throw new Error('private database detail'); },
        captureRecipeActivity: () => () => { throw new Error('private database detail'); },
    };
    for (const name of ['update_recipe', 'delete_recipe']) {
        const result = { content: [{ type: 'text', text: JSON.stringify({ success: true, recipe: { id: 'owned' } }) }] };
        assert.equal(await trackRecipeToolActivity(store, 'turn', name, { recipe_id: 'owned' }, async () => result), result);
    }
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every(message => !message.includes('private database detail')));
});
