import { seedIngredients } from './fixtures/ingredients.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDatabase, closeDatabase } from '../database.ts'
import { BrewingApplication } from '../application-service.ts'
import { callBrewingTool, listBrewingTools } from '../brewing-service.ts'
import { CAPABILITIES } from '../../../types/access.ts'

const folder = mkdtempSync(join(tmpdir(), 'brewey-application-'))
let counter = 0
function fixture(permissions = [...CAPABILITIES]) {
  closeDatabase()
  process.env.BREWEY_DATABASE_PATH = join(folder, `${counter++}.sqlite`)
  const db = getDatabase(); seedIngredients(db)
  for (const name of ['alice','bob']) db.prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)').run(name,name,'synthetic-only')
  return new BrewingApplication({userId:'alice',permissions})
}
async function scenario(fn) {
  const previousPath = process.env.BREWEY_DATABASE_PATH
  try { return await fn() } finally { closeDatabase();if(previousPath===undefined)delete process.env.BREWEY_DATABASE_PATH;else process.env.BREWEY_DATABASE_PATH=previousPath }
}
test.after(()=>{rmSync(folder,{recursive:true,force:true})})

test('capabilities apply to direct application operations and advertised MCP tools', ()=>scenario(async()=>{
  const app=fixture(),recipe=app.createRecipe({name:'Owner recipe'})
  const readonly=new BrewingApplication({userId:'alice',permissions:['recipes:read']})
  assert.equal(readonly.getRecipe(recipe.id).name,'Owner recipe')
  assert.throws(()=>readonly.updateRecipe(recipe.id,{name:'Changed'}),error=>error.status===403)
  assert.throws(()=>readonly.searchCatalog('grain'),error=>error.status===403)
  const names=listBrewingTools('alice',['recipes:read']).map(tool=>tool.name)
  assert.ok(names.includes('get_recipe_by_id'));assert.ok(!names.includes('create_recipe'));assert.ok(!names.includes('search_grains'));assert.ok(!names.includes('search_faq'))
  assert.equal((await callBrewingTool('alice','update_recipe',{recipe_id:recipe.id,name:'Changed'},['recipes:read'])).isError,true)
  assert.equal(app.getRecipe(recipe.id).name,'Owner recipe')
  const writer=new BrewingApplication({userId:'alice',permissions:['recipes:write']})
  assert.equal(writer.getRecipe(writer.createRecipe({name:'Writable'}).id).name,'Writable')
}))
test('principal is copied; caller authority changes and foreign resource IDs never bypass ownership',()=>scenario(async()=>{
  fixture();const principal={userId:'alice',permissions:['recipes:read']},readonly=new BrewingApplication(principal)
  principal.permissions.push('recipes:write');principal.userId='bob'
  assert.throws(()=>readonly.createRecipe({name:'Escalation'}),error=>error.status===403)
  const owner=new BrewingApplication({userId:'alice',permissions:[...CAPABILITIES]}),other=new BrewingApplication({userId:'bob',permissions:[...CAPABILITIES]})
  const a=owner.createRecipe({name:'First'}),b=owner.createRecipe({name:'Second'}),grain=owner.searchCatalog('grain').items[0]
  const row=owner.addRelation('grain',a.id,{grain_id:grain.id,amount_kg:4})
  assert.throws(()=>owner.updateRelation('grain',b.id,row.id,{amount_kg:8}),error=>error.status===404)
  assert.throws(()=>other.getRecipe(a.id),error=>error.status===404)
  assert.throws(()=>other.removeRelation('grain',a.id,row.id),error=>error.status===404)
  assert.equal(owner.getRelation('grain',a.id,row.id).amount_kg,4)
}))
test('tool and HTTP-shaped operations share hop timing rules and canonical metric storage',()=>scenario(async()=>{
  const app=fixture(),recipe=app.createRecipe({name:'Timing',boil_time_minutes:60}),hop=app.searchCatalog('hop').items[0]
  assert.throws(()=>app.addRelation('hop',recipe.id,{hop_id:hop.id,amount_grams:20,use_type:'boil',time_minutes:90}),/boil time/)
  const bad=await callBrewingTool('alice','add_hop_to_recipe',{recipe_id:recipe.id,hop_id:hop.id,amount_grams:20,use_type:'boil',time_minutes:90});assert.equal(bad.isError,true)
  const whirlpool=app.addRelation('hop',recipe.id,{hop_id:hop.id,amount_grams:20,use_type:'whirlpool',time_minutes:20});assert.equal(whirlpool.temperature_c,80)
  const first=app.updateRelation('hop',recipe.id,whirlpool.id,{use_type:'first_wort'});assert.equal(first.time_minutes,null);assert.equal(first.temperature_c,null)
  assert.throws(()=>app.updateRecipe(recipe.id,{boil_time_minutes:0}),/positive boil/)
  const boilHop=app.addRelation('hop',recipe.id,{hop_id:hop.id,amount_grams:10,use_type:'boil',time_minutes:60})
  assert.throws(()=>app.updateRecipe(recipe.id,{boil_time_minutes:20}),/shorter/);assert.equal(app.getRecipe(recipe.id).boil_time_minutes,60)
  const dry=app.updateRelation('hop',recipe.id,boilHop.id,{use_type:'dry_hop',dry_hop_duration_days:3});assert.equal(dry.time_minutes,null)
  assert.throws(()=>app.updateRelation('hop',recipe.id,boilHop.id,{use_type:'boil'}),/time_minutes is required/)
  app.removeRelation('hop',recipe.id,boilHop.id)
  app.updateProfile({unit_system:'imperial'})
  const tool=await callBrewingTool('alice','add_hop_to_recipe',{recipe_id:recipe.id,hop_id:hop.id,amount_oz:1,use_type:'boil',time_minutes:30})
  assert.equal(tool.isError,undefined);assert.equal(app.listRelations('hop',recipe.id)[1].amount_grams,28.349523125)
}))
test('catalog pagination includes records beyond the old 500-record cap and rejects ambiguous queries',()=>scenario(async()=>{
  const app=fixture(),db=getDatabase()
  for(let i=0;i<610;i++)db.prepare('INSERT INTO grains(id,data) VALUES(?,?)').run(`synthetic-${i}`,JSON.stringify({id:`synthetic-${i}`,name:`Synthetic ${String(i).padStart(3,'0')}`,must_mash:false,color_ebc:i}))
  const first=app.searchCatalog('grain',{q:'Synthetic',limit:'500'}),last=app.searchCatalog('grain',{q:'Synthetic',limit:'500',offset:'500'})
  assert.equal(first.total,610);assert.equal(last.items.length,110);assert.equal(new Set([...first.items,...last.items].map(row=>row.id)).size,610)
  assert.throws(()=>app.searchCatalog('grain',{limit:'501'}),error=>error.status===400)
  assert.throws(()=>app.searchCatalog('grain',{select:'*'}),error=>error.status===400)
  assert.throws(()=>app.searchCatalog('grain',{min_color_ebc:'90',max_color_ebc:'10'}),error=>error.status===400)
  assert.throws(()=>app.listRecipes({offset:'-1'}),error=>error.status===400)
}))
test('native export/import round-trips server state and invalid timing rolls back a whole import',()=>scenario(async()=>{
  const app=fixture(),source=app.createRecipe({name:'Export',brewing_notes:'Saved notes'}),grain=app.searchCatalog('grain').items[0],hop=app.searchCatalog('hop').items[0]
  app.addRelation('grain',source.id,{grain_id:grain.id,amount_kg:4});app.addRelation('hop',source.id,{hop_id:hop.id,amount_grams:25,time_minutes:60,use_type:'first_wort'})
  app.addRelation('mash',source.id,{name:'Mash',temperature_c:65,duration_minutes:60})
  const exported=app.exportRecipe(source.id);assert.equal(exported.recipe.brewing_notes,'Saved notes');assert.equal(exported.hops[0].time_minutes,null)
  assert.equal(exported.recipe.user_id,undefined);assert.equal(exported.grains[0].recipe_id,undefined)
  const imported=app.importRecipe(exported);assert.notEqual(imported.id,source.id);assert.equal(imported.recipe_grains[0].amount_kg,4);assert.equal(imported.recipe_mash_steps.length,1)
  const before=app.listRecipes().total,bad=structuredClone(exported);bad.hops[0].use_type='boil';bad.hops[0].time_minutes=90
  assert.throws(()=>app.importRecipe(bad),/boil time/);assert.equal(app.listRecipes().total,before)
}))
test('public payloads reject owner IDs and unknown fields before writes',()=>scenario(async()=>{
  const app=fixture();assert.throws(()=>app.createRecipe({name:'Bad',user_id:'bob'}),/Unknown field/)
  const recipe=app.createRecipe({name:'Clean'})
  assert.throws(()=>app.updateRecipe(recipe.id,{bogus:1}),/Unknown field/)
  assert.throws(()=>app.updateProfile({email:'wrong'}),/Unknown field/)
  for (const kind of ['mash','fermentation']) {
    const duration=kind==='mash'?{duration_minutes:60}:{duration_days:10}
    assert.throws(()=>app.addRelation(kind,recipe.id,{name:'Invalid process',temperature_c:null,...duration}),/temperature_c/)
    assert.equal(app.listRelations(kind,recipe.id).length,0)
    const step=app.addRelation(kind,recipe.id,{name:'Valid process',temperature_c:20,...duration})
    assert.throws(()=>app.updateRelation(kind,recipe.id,step.id,{temperature_c:null}),/temperature_c/)
    assert.equal(app.getRelation(kind,recipe.id,step.id).temperature_c,20)
  }
  assert.throws(()=>app.importRecipe({format:'brewey-native',version:'1.0.0',recipe:{name:'Bad import',user_id:'bob'}}),/Unknown field/)
  const hop=app.searchCatalog('hop').items[0]
  assert.throws(()=>app.importRecipe({format:'brewey-native',version:'1.0.0',recipe:{name:'Missing timing'},hops:[{hop_id:hop.id,amount_grams:10,use_type:'boil'}]}),/time_minutes is required/)
  assert.equal(app.listRecipes().total,1)
  assert.equal(app.getRecipe(recipe.id).name,'Clean')
}))
