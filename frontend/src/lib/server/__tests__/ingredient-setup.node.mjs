import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { getDatabase, closeDatabase, claimDatabaseMaintenance } from '../database.ts'
import { ingredientSetupStatus, startIngredientSetup } from '../ingredient-setup.ts'
import { applicationForUser } from '../application-service.ts'
const keys=['BREWEY_DATABASE_PATH','BREWEY_INGREDIENT_MANIFEST','BREWEY_INGREDIENT_CACHE','BREWEY_INGREDIENT_OFFLINE']
const grain=name=>Buffer.from(`<Grain><F_G_NAME>${name}</F_G_NAME><F_G_TYPE>0</F_G_TYPE><F_G_COLOR>2</F_G_COLOR><F_G_YIELD>80</F_G_YIELD><F_G_RECOMMEND_MASH>1</F_G_RECOMMEND_MASH></Grain>`)
async function fixture(operation) {
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]])),dir=mkdtempSync(join(tmpdir(),'brewey-setup-'))
 closeDatabase();process.env.BREWEY_DATABASE_PATH=join(dir,'db.sqlite');process.env.BREWEY_INGREDIENT_MANIFEST=join(dir,'manifest.json');process.env.BREWEY_INGREDIENT_CACHE=join(dir,'cache');process.env.BREWEY_INGREDIENT_OFFLINE='true'
 const db=getDatabase();assert.equal(db.prepare('SELECT count(*) n FROM grains').get().n,0);assert.ok(db.prepare('SELECT count(*) n FROM beer_styles').get().n)
 for (const [id,admin] of [['owner',1],['member',0]]) db.prepare('INSERT INTO users(id,username,password_hash,is_admin) VALUES(?,?,?,?)').run(id,id,'synthetic',admin)
 const one=grain('Synthetic Pilsner'),two=grain('Second Malt');writeFileSync(join(dir,'one.bsmx'),one);writeFileSync(join(dir,'identities.json'),JSON.stringify({version:1}))
 const source=(id,data,required=false)=>({id,format:'bsmx',priority:10,required,locations:[{path:id+'.bsmx',sha256:createHash('sha256').update(data).digest('hex')}]})
 const manifest={version:1,registry:'identities.json',sources:[source('one',one,true),source('two',two)]}
 writeFileSync(process.env.BREWEY_INGREDIENT_MANIFEST,JSON.stringify(manifest))
 try { await operation({db,dir,manifest,two}) }
 finally { closeDatabase();for(const k of keys) if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];rmSync(dir,{recursive:true,force:true}) }
}
async function completed() {
 const deadline=Date.now()+15_000
 while(Date.now()<deadline) {const status=ingredientSetupStatus('owner');if(status.state!=='running')return status;await new Promise(r=>setTimeout(r,25))}
 throw new Error('Ingredient worker did not finish')
}
test('partial build, one active worker, retry and used ingredient identity are preserved',()=>fixture(async({db,dir,two})=>{
 assert.throws(()=>startIngredientSetup('member'),e=>e.status===403)
 assert.throws(()=>ingredientSetupStatus('member'),e=>e.status===403)
 const start=startIngredientSetup('owner');assert.equal(start.state,'running');assert.equal(startIngredientSetup('owner').runId,start.runId)
 assert.throws(()=>claimDatabaseMaintenance(),/backup preparation/)
 const partial=await completed();assert.equal(partial.state,'partial');assert.deepEqual(partial.missing,['two']);assert.equal(partial.counts.grains,1);assert.equal(partial.completed,2)
 const app=applicationForUser('owner'),ingredient=app.searchCatalog('grain').items[0],recipe=app.createRecipe({name:'Retained recipe'})
 app.addRelation('grain',recipe.id,{grain_id:ingredient.id,amount_kg:4})
 const before=JSON.stringify(app.calculations(recipe.id));const stored=db.prepare('SELECT data FROM grains WHERE id=?').get(ingredient.id).data
 writeFileSync(join(dir,'two.bsmx'),two);startIngredientSetup('owner');const ready=await completed();assert.equal(ready.state,'ready');assert.equal(ready.counts.grains,2)
 assert.equal(db.prepare('SELECT data FROM grains WHERE id=?').get(ingredient.id).data,stored);assert.equal(JSON.stringify(app.calculations(recipe.id)),before)
 closeDatabase();assert.equal(ingredientSetupStatus('owner').state,'ready');assert.equal(getDatabase().prepare('SELECT count(*) n FROM users').get().n,2)
}))
test('required source failure retains the previously imported catalogue',()=>fixture(async({db,dir,manifest,two})=>{
 startIngredientSetup('owner');assert.equal((await completed()).state,'partial');const before=db.prepare('SELECT * FROM grains').all()
 manifest.sources[1].required=true;writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));startIngredientSetup('owner');assert.equal((await completed()).state,'failed');assert.deepEqual(db.prepare('SELECT * FROM grains').all(),before)
 writeFileSync(join(dir,'two.bsmx'),two);startIngredientSetup('owner');assert.equal((await completed()).state,'ready')
}))
test('failed database insertion rolls back all ingredient changes',()=>fixture(async({db,dir,two})=>{
 startIngredientSetup('owner');await completed();const before=db.prepare('SELECT * FROM grains').all()
 writeFileSync(join(dir,'two.bsmx'),two)
 db.exec("CREATE TRIGGER refuse_setup BEFORE INSERT ON grains WHEN json_extract(NEW.data,'$.name')='Second Malt' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
 startIngredientSetup('owner');assert.equal((await completed()).state,'failed');assert.deepEqual(db.prepare('SELECT * FROM grains').all(),before)
 db.exec('DROP TRIGGER refuse_setup');startIngredientSetup('owner');assert.equal((await completed()).state,'ready')
}))
test('an abandoned job is retryable after restart',()=>fixture(async({db})=>{
 db.prepare('INSERT INTO installation_settings VALUES(?,?)').run('ingredient_catalog_setup',JSON.stringify({state:'running',runId:'abandoned',updatedAt:Date.now()-90_000,counts:{},missing:[],completed:0,total:2}))
 assert.equal(ingredientSetupStatus('owner').state,'failed');startIngredientSetup('owner');assert.equal((await completed()).state,'partial')
}))
