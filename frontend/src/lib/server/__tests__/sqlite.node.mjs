import { seedIngredients } from './fixtures/ingredients.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDatabase, closeDatabase, transaction, RELATION_TABLES, SCHEMA_VERSION } from '../database.ts'
import { getRepository } from '../repository.ts'
import { listBrewingTools, callBrewingTool } from '../brewing-service.ts'
import { exportDatabaseSnapshot, importDatabaseSnapshot } from '../migration.ts'
const dir=mkdtempSync(join(tmpdir(),'brewey-sqlite-test-'))
process.env.BREWEY_DATABASE_PATH=join(dir,'library.sqlite')
function users(){const db=getDatabase();seedIngredients(db);for(const id of ['alice','bob'])db.prepare('INSERT OR IGNORE INTO users(id,username,email,password_hash) VALUES (?,?,?,?)').run(id,id,`${id}@example.test`,'test-only-not-a-password-hash')}
function parse(result){return JSON.parse(result.content.find(item=>item.type==='text').text)}
const alice=()=>getRepository('alice'),bob=()=>getRepository('bob')
test.after(()=>{closeDatabase();rmSync(dir,{recursive:true,force:true});delete process.env.BREWEY_DATABASE_PATH})

test('real file uses WAL/FK/busy timeout, seeded clean reference library and persists after reopen',()=>{
 users();const db=getDatabase();assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout,5000)
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);assert.equal(alice().listRecipes().length,0)
 const recipe=alice().createRecipe({name:'Persistence',user_id:'bob'});assert.equal(recipe.user_id,'alice')
 closeDatabase();assert.equal(alice().getRecipe(recipe.id).name,'Persistence');assert.equal(statSync(process.env.BREWEY_DATABASE_PATH).mode&0o777,0o600)
 alice().deleteRecipe(recipe.id)
})
test('every recipe relation is owned on read, insert, update, remove; cascades',()=>{
 users();const a=alice(),b=bob(),recipe=a.createRecipe({name:'Isolated'})
 const specs={recipe_grains:{grain_id:a.searchCatalog('grains')[0].id,amount_kg:4},recipe_hops:{hop_id:a.searchCatalog('hops')[0].id,amount_grams:25,time_minutes:60,use_type:'boil'},recipe_yeasts:{yeast_id:a.searchCatalog('yeasts')[0].id,amount_units:1},recipe_misc:{misc_id:a.searchCatalog('misc_ingredients')[0].id,amount_units:1},recipe_water:{name:'Water',volume_liters:25},recipe_mash_steps:{name:'Mash',temperature_c:67,duration_minutes:60},recipe_fermentation_steps:{name:'Primary',temperature_c:19,duration_days:7}}
 for(const table of RELATION_TABLES){const row=a.addRelation(table,recipe.id,specs[table]);assert.throws(()=>b.listRelations(table,recipe.id),/access denied/);assert.throws(()=>b.getRelation(table,row.id),/access denied/);assert.throws(()=>b.addRelation(table,recipe.id,specs[table]),/access denied/);assert.throws(()=>b.updateRelation(table,row.id,{name:'stolen'}),/access denied/);assert.throws(()=>b.removeRelation(table,row.id),/access denied/)}
 assert.equal(b.listRecipes().length,0);assert.throws(()=>b.getRecipe(recipe.id),/access denied/);assert.throws(()=>b.getCalculations(recipe.id),/access denied/);assert.throws(()=>b.updateRecipe(recipe.id,{name:'stolen'}),/access denied/);assert.throws(()=>b.cloneRecipe(recipe.id,'stolen'),/access denied/);assert.throws(()=>b.deleteRecipe(recipe.id),/access denied/)
 a.deleteRecipe(recipe.id);for(const table of RELATION_TABLES)assert.equal(getDatabase().prepare(`SELECT count(*) AS n FROM ${table} WHERE recipe_id=?`).get(recipe.id).n,0)
})
test('clone is complete and isolated; failed native import transaction leaves no partial recipe',()=>{
 const a=alice(),r=a.createRecipe({name:'Source',brewing_notes:'notes'}),g=a.searchCatalog('grains',{name:'Pilsner'})[0]
 a.addRelation('recipe_grains',r.id,{grain_id:g.id,amount_kg:4});a.addRelation('recipe_mash_steps',r.id,{name:'Mash',temperature_c:65,duration_minutes:60});a.addRelation('recipe_fermentation_steps',r.id,{name:'Primary',temperature_c:20,duration_days:10});a.addRelation('recipe_water',r.id,{name:'Water',volume_liters:25,base_ca_ppm:0})
 const clone=a.cloneRecipe(r.id,'Clone'),full=a.getRecipe(clone.id)
 assert.equal(full.recipe_grains[0].amount_kg,4);assert.notEqual(full.recipe_grains[0].id,a.getRecipe(r.id).recipe_grains[0].id);assert.equal(full.recipe_mash_steps.length,1);assert.equal(full.recipe_fermentation_steps.length,1);assert.equal(full.recipe_water[0].base_ca_ppm,0)
 const count=a.listRecipes().length;assert.throws(()=>a.importNativeRecipe({format:'brewey-native',recipe:{name:'Bad import'},grains:[{grain_id:'missing',grain_name:'Missing ingredient',amount_kg:1}]}),/unavailable/);assert.equal(a.listRecipes().length,count)
 a.deleteRecipe(r.id);a.deleteRecipe(clone.id)
})
test('37 tools use profile unit schema, persist metric and emit imperial plus calculations',async()=>{
 const a=alice();a.updateProfile({profile:'Small brewery',unit_system:'imperial',preferences:{codexModel:'test'}})
 const tools=listBrewingTools('alice');assert.equal(tools.length,37);assert.ok(tools.find(t=>t.name==='add_grain_to_recipe').inputSchema.properties.amount_lb)
 const result=parse(await callBrewingTool('alice','create_recipe',{name:'Imperial',batch_size_gallons:5,mash_thickness:1.5}));assert.equal(result.success,true);const id=result.recipe.id
 assert.ok(Math.abs(a.getRecipe(id).batch_size_liters-18.92705892)<1e-9);assert.equal(result.recipe.batch_size_gallons,5);assert.equal(result.recipe.batch_size_liters,undefined);assert.ok(Math.abs(result.recipe.mash_thickness_qt_per_lb-1.5)<1e-12)
 const grain=a.searchCatalog('grains',{name:'Pilsner'})[0];const added=parse(await callBrewingTool('alice','add_grain_to_recipe',{recipe_id:id,grain_id:grain.id,amount_lb:10}));assert.equal(added.success,true);assert.equal(added.recipe_grain.amount_lb,10);assert.ok(Math.abs(a.getRecipe(id).recipe_grains[0].amount_kg-4.5359237)<1e-9);assert.ok(added.updated_calculations.og>1)
 const denied=await callBrewingTool('bob','update_grain_in_recipe',{recipe_grain_id:added.recipe_grain.id,amount_kg:9});assert.equal(denied.isError,true);assert.ok(Math.abs(a.getRecipe(id).recipe_grains[0].amount_kg-4.5359237)<1e-9)
 const invalid=await callBrewingTool('alice','add_grain_to_recipe',{recipe_id:id,grain_id:grain.id,amount_lb:-10});assert.equal(invalid.isError,true)
 const details=parse(await callBrewingTool('alice','get_recipe_by_id',{recipe_id:id}));assert.equal(details.recipe.grains[0].recipe_grain_id,added.recipe_grain.id);assert.equal(details.recipe.grains[0].amount_lb,10)
 a.deleteRecipe(id);a.updateProfile({unit_system:'metric'})
})
test('profile and preferences remain per user, invalid updates roll back',()=>{
 const a=alice();a.updateProfile({profile:'Alice',preferences:{reasoning:'high'}});assert.notEqual(bob().getProfile().profile,'Alice')
 assert.throws(()=>a.updateProfile({unit_system:'kelvin',profile:'bad'}),/unit system/);assert.equal(a.getProfile().profile,'Alice')
 const r=a.createRecipe({name:'Valid'});assert.throws(()=>a.updateRecipe(r.id,{name:'Bad',efficiency_percent:NaN}),/finite/);assert.equal(a.getRecipe(r.id).name,'Valid');a.deleteRecipe(r.id)
 const db=getDatabase();assert.throws(()=>transaction(db,()=>{a.createRecipe({name:'Transient'});throw new Error('rollback')}),/rollback/);assert.equal(a.listRecipes().length,0)
})
test('snapshot round trip preserves IDs, relations and calculated values atomically',()=>{
 const a=alice(),r=a.createRecipe({name:'Backup'});a.addRelation('recipe_grains',r.id,{grain_id:a.searchCatalog('grains')[0].id,amount_kg:4});const expected=a.getCalculations(r.id),snapshot=exportDatabaseSnapshot()
 closeDatabase();process.env.BREWEY_DATABASE_PATH=join(dir,'restore.sqlite');const counts=importDatabaseSnapshot(snapshot.tables);assert.equal(counts.recipes,1);assert.deepEqual(alice().getCalculations(r.id),expected);assert.equal(alice().getRecipe(r.id).recipe_grains.length,1);assert.throws(()=>importDatabaseSnapshot(snapshot.tables),/empty/)
 closeDatabase();process.env.BREWEY_DATABASE_PATH=join(dir,'bad-restore.sqlite');const broken=structuredClone(snapshot.tables);broken.recipe_grains[0].grain_id='missing';assert.throws(()=>importDatabaseSnapshot(broken),/FOREIGN KEY/);assert.equal(getDatabase().prepare('SELECT count(*) AS n FROM users').get().n,0)
})

test('all relation tool CRUD lifecycles, catalog search, schema validation and reorder contracts',async()=>{
 closeDatabase();process.env.BREWEY_DATABASE_PATH=join(dir,'tools.sqlite');users();const a=alice(),r=a.createRecipe({name:'Full tool contract'})
 const calls={
  grain:{grain_id:a.searchCatalog('grains',{name:'Pilsner'})[0].id,amount_kg:3},
  hop:{hop_id:a.searchCatalog('hops',{name:'Cascade'})[0].id,amount_grams:25,use_type:'whirlpool',time_minutes:20},
  yeast:{yeast_id:a.searchCatalog('yeasts',{name:'US-05'})[0].id,amount_units:1},
  misc:{misc_ingredient_id:a.searchCatalog('misc_ingredients',{name:'Gypsum'})[0].id,amount_units:1,use_type:'mash'},
  water:{name:'Mash water',volume_liters:15,ca_ppm:50,mg_ppm:5,na_ppm:5,so4_ppm:50,cl_ppm:50,hco3_ppm:20},
  mash_step:{name:'Mash',temperature_c:65,duration_minutes:60},
  fermentation_step:{name:'Primary',temperature_c:19,duration_days:10},
 }
 for(const[kind,args]of Object.entries(calls)){
  const add=await callBrewingTool('alice',`add_${kind}_to_recipe`,{recipe_id:r.id,...args});assert.equal(add.isError,undefined,JSON.stringify(add));const added=parse(add)[`recipe_${kind}`];assert.ok(added.id)
  if(kind==='hop')assert.equal(added.temperature_c,80)
  const fields={grain:{amount_kg:4},hop:{use_type:'dry_hop',dry_hop_duration_days:3,dry_hop_start_day:7},yeast:{amount_units:2},misc:{amount_units:2},water:{volume_liters:20},mash_step:{temperature_c:67},fermentation_step:{end_temperature_c:21}}
  const update=await callBrewingTool('alice',`update_${kind}_in_recipe`,{[`recipe_${kind}_id`]:added.id,...fields[kind]});assert.equal(update.isError,undefined,JSON.stringify(update));const updated=parse(update)[`recipe_${kind}`]
  if(kind==='hop')assert.equal(updated.temperature_c,null)
  const remove=parse(await callBrewingTool('alice',`remove_${kind}_from_recipe`,{[`recipe_${kind}_id`]:added.id}));assert.equal(remove.success,true);assert.equal(remove.removed_item.id,added.id);assert.equal(remove.recipe_id,r.id)
 }
 const first=a.addRelation('recipe_mash_steps',r.id,{name:'First',temperature_c:65,duration_minutes:30}),second=a.addRelation('recipe_mash_steps',r.id,{name:'Second',temperature_c:67,duration_minutes:30,step_order:1})
 assert.deepEqual(a.listRelations('recipe_mash_steps',r.id).map(x=>[x.name,x.step_order]),[['Second',1],['First',2]])
 a.updateRelation('recipe_mash_steps',first.id,{step_order:1});assert.deepEqual(a.listRelations('recipe_mash_steps',r.id).map(x=>x.name),['First','Second']);a.removeRelation('recipe_mash_steps',first.id);assert.equal(a.getRelation('recipe_mash_steps',second.id).step_order,1)
 const hops=parse(await callBrewingTool('alice','search_hops',{min_alpha_acid:10,limit:20})).hops;assert.ok(hops.length>0);assert.ok(hops.every(h=>h.alpha_acid_percent>=10))
 const styles=parse(await callBrewingTool('alice','search_beer_styles',{search:'21A'})).styles;assert.ok(styles.some(style=>style.number==='21A'));assert.ok(parse(await callBrewingTool('alice','get_style_by_id',{style_id:'21A'})).style.vital_statistics)
 assert.ok(Array.isArray(parse(await callBrewingTool('alice','find_styles_for_recipe',{recipe_id:r.id,keywords:['hoppy']})).matching_styles))
 for(const tool of ['get_privacy_policy','get_terms_of_use'])assert.equal((await callBrewingTool('alice',tool,{})).isError,undefined)
 for(const args of [{name:''},{name:'Invalid',batch_size_liters:0},{name:'Invalid',efficiency_percent:101},{name:'Invalid',batch_size_liters:'20'}])assert.equal((await callBrewingTool('alice','create_recipe',args)).isError,true)
 assert.equal((await callBrewingTool('alice','add_hop_to_recipe',{recipe_id:r.id,hop_id:calls.hop.hop_id,amount_grams:25,use_type:'nonsense'})).isError,true)
 a.deleteRecipe(r.id)
})
test('flat native export imports catalog names when foreign IDs differ, preserving process and notes',()=>{
 const a=alice(),style=a.searchCatalog('beer_styles',{number:'21A'})[0]
 const imported=a.importNativeRecipe({format:'brewey-native',version:'1.0.0',recipe:{name:'Imported',bjcp_style_id:'old-style',bjcp_style_number:'21A',brewing_notes:'Preserved'},grains:[{grain_name:'Pilsner Malt',amount_kg:4}],mash_steps:[{name:'Mash',temperature_c:66,duration_minutes:60,step_order:1}],fermentation_steps:[{name:'Primary',temperature_c:20,end_temperature_c:null,duration_days:10,step_order:1}]})
 const result=a.getRecipe(imported.recipeId);assert.equal(result.bjcp_style_id,style.id);assert.equal(result.recipe_grains.length,1);assert.equal(result.brewing_notes,'Preserved');assert.equal(result.recipe_mash_steps.length,1);assert.equal(result.recipe_fermentation_steps.length,1)
 a.deleteRecipe(result.id)
})


test('chat canonical updates stay metric while agent tool content remains imperial',async()=>{
 const {canonicalRecipeToolResult}=await import('../chat-recipe-updates.ts')
 closeDatabase();process.env.BREWEY_DATABASE_PATH=join(dir,'chat-units.sqlite');users();const a=alice();a.updateProfile({unit_system:'imperial'})
 const rawCreated=await callBrewingTool('alice','create_recipe',{name:'Imperial UI',batch_size_gallons:5,mash_thickness:1.5})
 const created=parse(rawCreated),text=rawCreated.content[0].text,canonical=canonicalRecipeToolResult('alice','create_recipe',created)
 assert.equal(created.recipe.batch_size_liters,undefined);assert.equal(created.recipe.batch_size_gallons,5)
 assert.ok(Math.abs(canonical.recipe.batch_size_liters-18.92705892)<1e-9);assert.ok(canonical.recipe.mash_thickness>3);assert.equal(canonical.recipe.calculated_ebc,0);assert.equal(rawCreated.content[0].text,text)
 const grainId=a.searchCatalog('grains',{name:'Pilsner Malt'}).find(grain=>grain.name==='Pilsner Malt').id,addition=parse(await callBrewingTool('alice','add_grain_to_recipe',{recipe_id:created.recipe.id,grain_id:grainId,amount_lb:10}))
 const update=canonicalRecipeToolResult('alice','add_grain_to_recipe',addition)
 assert.equal(addition.recipe_grain.amount_kg,undefined);assert.ok(Math.abs(update.recipe_grain.amount_kg-4.5359237)<1e-9);assert.equal(update.grain_details.color_ebc,3.5);assert.ok(update.updated_calculations.ebc>0);assert.equal(update.updated_calculations.srm,undefined)
 const modified=parse(await callBrewingTool('alice','update_recipe',{recipe_id:created.recipe.id,batch_size_gallons:6}))
 assert.ok(Math.abs(canonicalRecipeToolResult('alice','update_recipe',modified).recipe.batch_size_liters-22.712470704)<1e-9)
 const removal=parse(await callBrewingTool('alice','remove_grain_from_recipe',{recipe_grain_id:addition.recipe_grain.id}))
 assert.equal(canonicalRecipeToolResult('alice','remove_grain_from_recipe',removal).removed_item.id,addition.recipe_grain.id)
 assert.throws(()=>canonicalRecipeToolResult('bob','update_recipe',modified),/access denied/)
 a.deleteRecipe(created.recipe.id)
})

test('hop/misc timing preserves calculation requirements and clears incompatible stages',async()=>{
 const a=alice(),r=a.createRecipe({name:'Timing',boil_time_minutes:60}),hop=a.searchCatalog('hops')[0],misc=a.searchCatalog('misc_ingredients')[0]
 for(const args of [{use_type:'boil',time_minutes:90},{use_type:'whirlpool'}])assert.equal((await callBrewingTool('alice','add_hop_to_recipe',{recipe_id:r.id,hop_id:hop.id,amount_oz:1,...args})).isError,true)
 assert.equal((await callBrewingTool('alice','add_misc_to_recipe',{recipe_id:r.id,misc_ingredient_id:misc.id,amount_units:1,use_type:'boil',time_minutes:90})).isError,true)
 const addition=parse(await callBrewingTool('alice','add_hop_to_recipe',{recipe_id:r.id,hop_id:hop.id,amount_oz:1,use_type:'dry_hop',dry_hop_start_day:7,dry_hop_duration_days:3})).recipe_hop
 assert.ok(addition.id)
 const moved=parse(await callBrewingTool('alice','update_hop_in_recipe',{recipe_hop_id:addition.id,use_type:'whirlpool',time_minutes:20})).recipe_hop
 assert.equal(moved.temperature_f,176);assert.equal(moved.dry_hop_start_day,null);assert.equal(moved.dry_hop_duration_days,null)
 const stage=parse(await callBrewingTool('alice','add_misc_to_recipe',{recipe_id:r.id,misc_ingredient_id:misc.id,amount_units:1,use_type:'primary',start_day:3,duration_days:4,time_minutes:20})).recipe_misc
 assert.equal(stage.time_minutes,null)
 const bottled=parse(await callBrewingTool('alice','update_misc_in_recipe',{recipe_misc_id:stage.id,use_type:'bottling'})).recipe_misc
 assert.equal(bottled.time_minutes,null);assert.equal(bottled.start_day,null);assert.equal(bottled.duration_days,null)
 a.deleteRecipe(r.id)
})
