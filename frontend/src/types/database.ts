export interface Recipe {
  id: string
  user_id: string
  name: string
  description: string | null
  batch_size_liters: number
  boil_time_minutes: number
  efficiency_percent: number
  mash_thickness: number | null
  brewing_notes: string | null
  tasting_notes: string | null
  bjcp_style_id: string | null
  created_at: string
  updated_at: string
}

export interface RecipeWithCalculations extends Recipe {
  calculated_og: number | null
  calculated_fg: number | null
  calculated_abv: number | null
  calculated_ibu: number | null
  calculated_ebc: number | null
}

export interface Grain {
  id: string
  name: string
  grain_type: string
  color_ebc: number
  extract_potential: number
  must_mash: boolean
  origin: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Hop {
  id: string
  name: string
  alpha_acid_percent: number
  beta_acid_percent: number | null
  hop_type: string
  form: string
  origin: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Yeast {
  id: string
  name: string
  yeast_type: string
  form: string
  laboratory: string | null
  product_id: string | null
  temperature_range_min: number | null
  temperature_range_max: number | null
  attenuation_percent: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface RecipeGrain {
  id: string
  recipe_id: string
  grain_id: string
  amount_kg: number
  created_at: string
  grains?: Grain
  
  // Imperial/US Customary properties (from MCP responses)
  amount_lb?: number
}

export interface RecipeHop {
  id: string
  recipe_id: string
  hop_id: string
  amount_grams: number
  time_minutes: number
  use_type: 'boil' | 'dry_hop' | 'first_wort' | 'whirlpool' | 'mash'
  created_at: string
  alpha_acid_percent_override?: number | null
  temperature_c?: number | null
  dry_hop_duration_days?: number | null
  dry_hop_start_day?: number | null
  hops?: Hop
  
  // Imperial/US Customary properties (from MCP responses)
  amount_oz?: number
  temperature_f?: number
}

export interface RecipeYeast {
  id: string
  recipe_id: string
  yeast_id: string
  amount_units: number
  unit_type: 'packets' | 'grams' | 'ml' | 'cells'
  created_at: string
  yeasts?: Yeast
}

export interface MiscIngredient {
  id: string
  name: string
  ingredient_type: 'water_agent' | 'flavor' | 'fining' | 'yeast_nutrient' | 'wine_making' | 'preservative' | 'bottling' | 'color' | 'other'
  notes: string | null
  created_at: string
  updated_at: string
}

export interface RecipeMisc {
  id: string
  recipe_id: string
  misc_id: string
  amount_units: number
  unit_type: 'grams' | 'ml' | 'tsp' | 'tbsp' | 'oz' | 'tablets' | 'drops' | 'pieces'
  use_type: 'mash' | 'boil' | 'primary' | 'secondary' | 'bottling' | 'aging'
  time_minutes: number | null
  start_day?: number | null
  duration_days?: number | null
  created_at: string
  misc_ingredients?: MiscIngredient
}

// Water calculation types
export interface WaterSaltAdditions {
  gypsum_caso4_grams: number
  calcium_chloride_cacl2_grams: number
  epsom_salt_mgso4_grams: number
  table_salt_nacl_grams: number
  baking_soda_nahco3_grams: number
}

export interface WaterProfile {
  ca_ppm: number
  mg_ppm: number
  na_ppm: number
  so4_ppm: number
  cl_ppm: number
  hco3_ppm: number
}

export interface WaterAnalysis {
  alkalinity_ppm: number
  residual_alkalinity: number
  sulfate_chloride_ratio: number
  sulfate_chloride_balance: string
  total_hardness_ppm: number
  effective_hardness_ppm: number
  color_range: string
}

export interface WaterCalculations {
  success: boolean
  salt_additions: WaterSaltAdditions
  calculated_profile: WaterProfile
  deviations: WaterProfile
  total_salt_weight_grams: number
  water_analysis: WaterAnalysis
}

export interface RecipeWater {
  id: string
  recipe_id: string
  name: string
  volume_liters: number
  
  // Target water profile (required)
  ca_ppm: number | null
  cl_ppm: number | null
  hco3_ppm: number | null
  mg_ppm: number | null
  na_ppm: number | null
  so4_ppm: number | null
  
  // Base water profile (optional - for brewing salt calculations)
  base_ca_ppm: number | null
  base_cl_ppm: number | null
  base_hco3_ppm: number | null
  base_mg_ppm: number | null
  base_na_ppm: number | null
  base_so4_ppm: number | null
  
  // Calculated brewing salt additions and water analysis (auto-generated)
  water_calculations: WaterCalculations | null
  
  created_at: string
  
  // Imperial/US Customary properties (from MCP responses)
  volume_gallons?: number
}

export interface RecipeWithIngredients extends Recipe {
  beer_styles?: BeerStyle | null
  recipe_grains: RecipeGrain[]
  recipe_hops: RecipeHop[]
  recipe_yeasts: RecipeYeast[]
  recipe_misc: RecipeMisc[]
  recipe_water: RecipeWater[]
}

// New types for granular state management
export interface BeerStyle {
  id: string
  name: string
  number: string
  category: string
  category_number: string
  style_guide: string
  og_min: number | null
  og_max: number | null
  fg_min: number | null
  fg_max: number | null
  abv_min: number | null
  abv_max: number | null
  ibu_min: number | null
  ibu_max: number | null
  ebc_min: number | null
  ebc_max: number | null
  overall_impression: string | null
  aroma: string | null
  appearance: string | null
  flavor: string | null
  mouthfeel: string | null
  comments: string | null
  history: string | null
  characteristic_ingredients: string | null
  style_comparison: string | null
  commercial_examples: string | null
  entry_instructions: string | null
  tags: string | null
  created_at: string | null
  updated_at: string | null
  
  // Imperial/US Customary properties (from MCP responses)
  srm_min?: number | null
  srm_max?: number | null
}

export interface RecipeMetadata {
  id: string
  user_id: string
  name: string
  description: string | null
  batch_size_liters: number
  boil_time_minutes: number
  efficiency_percent: number
  mash_thickness: number | null
  brewing_notes: string | null
  tasting_notes: string | null
  bjcp_style_id: string | null
  created_at: string
  updated_at: string
  beer_style?: BeerStyle | null
  
  // Imperial/US Customary properties (from MCP responses)
  batch_size_gallons?: number
  mash_thickness_qt_per_lb?: number
}

export interface RecipeCalculations {
  calculated_og: number | null
  calculated_fg: number | null
  calculated_abv: number | null
  calculated_ibu: number | null
  calculated_ebc: number | null
  batch_size_liters: number
  boil_time_minutes: number
  efficiency_percent: number
  mash_thickness: number | null
  
  // Imperial/US Customary properties (from MCP responses)
  calculated_srm?: number | null
  batch_size_gallons?: number
  mash_thickness_qt_per_lb?: number | null
}

// Mash and Fermentation Step interfaces
export interface RecipeMashStep {
  id: string
  recipe_id: string
  step_order: number
  name: string
  temperature_c: number
  duration_minutes: number
  description: string | null
  created_at: string
  
  // Imperial/US Customary properties (from MCP responses)
  temperature_f?: number
}

export interface RecipeFermentationStep {
  id: string
  recipe_id: string
  step_order: number
  name: string
  temperature_c: number
  end_temperature_c: number | null
  duration_days: number
  description: string | null
  created_at: string
  
  // Imperial/US Customary properties (from MCP responses)
  temperature_f?: number
  end_temperature_f?: number | null
}

export interface ApiResponse<T> {
  data: T | null
  error: string | null
}