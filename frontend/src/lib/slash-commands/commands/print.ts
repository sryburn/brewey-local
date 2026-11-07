/**
 * Print slash command - generates a beautifully formatted recipe for brew day
 */

import type { SlashCommandHandler, SlashCommandResult } from '../types'
import useChatStore from '@/lib/stores/chat-store'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import { formatHopTimingForPrint, formatMiscTimingForPrint } from '@/lib/utils/timing-formatters'
import type { UnitSystem } from '@/lib/utils/unit-conversion'
import { 
  formatWeight, 
  formatVolume, 
  formatBatchSize, 
  formatTemperature, 
  formatMashThickness,
  formatColor,
  getWeightValue,
  conversions
} from '@/lib/utils/unit-conversion'

// Import existing types instead of duplicating
import type { 
  RecipeMetadata, 
  RecipeGrain, 
  RecipeHop, 
  RecipeYeast, 
  RecipeMisc, 
  RecipeWater, 
  RecipeMashStep, 
  RecipeFermentationStep,
  RecipeCalculations 
} from '@/types/database'

// Simple interface for what we actually need
interface PrintRecipeData {
  metadata: RecipeMetadata
  grains: RecipeGrain[]
  hops: RecipeHop[]
  yeasts: RecipeYeast[]
  misc: RecipeMisc[]
  water: RecipeWater[]
  mashSteps: RecipeMashStep[]
  fermentationSteps: RecipeFermentationStep[]
  calculations: RecipeCalculations | null
}

function htmlEscape(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function normalizeUnit(unit: string): string {
  const unitMap: Record<string, string> = {
    'grams': 'g',
    'gram': 'g',
    'milliliters': 'ml',
    'milliliter': 'ml',
    'teaspoons': 'tsp',
    'teaspoon': 'tsp',
    'tablespoons': 'tbsp',
    'tablespoon': 'tbsp',
    'ounces': 'oz',
    'ounce': 'oz',
    'packets': 'packets', // Keep as is
    'cells': 'cells', // Keep as is
    'tablets': 'tablets', // Keep as is
    'drops': 'drops', // Keep as is
    'pieces': 'pieces' // Keep as is
  }
  return unitMap[unit.toLowerCase()] || unit
}

async function markdownToHtml(markdown: string): Promise<string> {
  if (!markdown) return ''
  
  try {
    // Dynamic imports - only loaded when /print is executed
    const { remark } = await import('remark')
    const remarkGfm = (await import('remark-gfm')).default  // You already have this
    const remarkHtml = (await import('remark-html')).default
    
    // Use the same processing chain as your chat components
    const result = await remark()
      .use(remarkGfm)    // Same GFM support as your chat
      .use(remarkHtml)   // HTML output instead of React
      .process(markdown)
      
    let html = String(result)
    
    // Add class to tables for styling
    html = html.replace(/<table>/g, '<table class="markdown-table">')
    
    return html
  } catch (error) {
    // Fallback to escaped plain text if processing fails
    console.warn('Markdown processing failed:', error)
    return `<p>${htmlEscape(markdown)}</p>`
  }
}

// CSS styles for the print layout
// Helper function to generate ingredient tables with consistent styling
function generateIngredientTable(
  headers: Array<{text: string, style?: string}>, 
  rows: string[],
  emptyMessage = 'No ingredients'
): string {
  return `
    <table class="ingredients-table">
      <thead>
        <tr>
          ${headers.map(h => `<th${h.style ? ` style="${h.style}"` : ''}>${h.text}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="no-ingredients">${emptyMessage}</td></tr>`}
      </tbody>
    </table>
  `
}


const PRINT_CSS = `
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; }
  body { 
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial, sans-serif; 
    line-height: 1.4; 
    background: #ffffff; 
    color: #0f172a; 
    font-size: 14px;
  }
  .container { max-width: 800px; margin: 0 auto; padding: 20px; }
  
  /* Header Styles */
  .header { 
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 20px; 
    border-bottom: 2px solid #e2e8f0; 
    padding-bottom: 15px; 
  }
  .header h1 { font-size: 28px; margin: 0; color: #1e293b; }
  .actions { margin: 0; }
  .btn { 
    display: inline-flex; 
    align-items: center; 
    gap: 6px; 
    padding: 8px 16px; 
    font-size: 14px; 
    border-radius: 6px; 
    border: 1px solid #d1d5db; 
    background: #f8fafc; 
    color: #374151; 
    text-decoration: none; 
    cursor: pointer;
    font-weight: 500;
  }
  .btn:hover { background: #e2e8f0; }
  
  /* Target Metrics */
  .metrics-list { 
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin: 15px 0; 
    padding: 12px; 
    background: #f8fafc; 
    border-radius: 6px; 
    border: 1px solid #e2e8f0; 
    font-size: 14px;
  }
  .metrics-column {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .metric-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .metric-label {
    color: #64748b;
    font-weight: 500;
  }
  .metric-value {
    color: #1e293b;
    font-weight: 600;
  }
  
  /* Recipe Description */
  .recipe-description { 
    margin: 15px 0; 
    font-size: 16px; 
    color: #374151; 
    line-height: 1.6;
  }
  .recipe-description p { margin: 0; }
  
  /* Recipe Info */
  .recipe-info { 
    margin: 15px 0; 
    font-size: 14px; 
    color: #374151;
  }
  .recipe-info p { margin: 0; }
  
  /* Metrics Title */
  .metrics-title {
    margin: 20px 0 10px;
    font-size: 18px;
    font-weight: 600;
    color: #1e293b;
  }
  
  /* Section Styles */
  .section { margin: 25px 0; }
  .section h2 { 
    font-size: 20px; 
    margin: 0 0 12px; 
    color: #1e293b; 
    border-bottom: 1px solid #e2e8f0; 
    padding-bottom: 6px; 
  }
  
  /* Table Styles */
  .ingredients-table { 
    width: 100%; 
    border-collapse: collapse; 
    margin: 12px 0; 
    table-layout: fixed;
  }
  .ingredients-table th { 
    background: #f1f5f9; 
    padding: 10px 8px; 
    text-align: left; 
    font-weight: 600; 
    font-size: 13px; 
    border: 1px solid #e2e8f0; 
    color: #374151; 
  }
  /* Column widths are now set inline in headers for clarity */
  .ingredients-table td { 
    padding: 8px; 
    border: 1px solid #e2e8f0; 
    vertical-align: top; 
    word-wrap: break-word;
  }
  .ingredient-name { font-weight: 500; color: #1e293b; }
  .ingredient-amount { font-weight: 600; color: #059669; text-align: right; white-space: nowrap; }
  .ingredient-details { color: #64748b; font-size: 12px; }
  .no-ingredients { text-align: center; color: #9ca3af; font-style: italic; }
  
  /* Steps Styles */
  .steps { margin: 15px 0; }
  .step { 
    display: flex; 
    margin: 12px 0; 
    padding: 12px; 
    background: #fefefe; 
    border: 1px solid #e2e8f0; 
    border-radius: 6px; 
  }
  .step-number { 
    background: #3b82f6; 
    color: white; 
    width: 24px; 
    height: 24px; 
    border-radius: 50%; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    font-weight: 600; 
    font-size: 12px; 
    margin-right: 12px; 
    flex-shrink: 0; 
  }
  .step-content h4 { margin: 0 0 4px; font-size: 14px; color: #1e293b; }
  .step-content p { margin: 0 0 6px; font-size: 13px; }
  .step-description { color: #64748b; }
  .water-volume { color: #0369a1; font-weight: 500; }
  
  /* Water Treatment */
  .water-note { margin: 12px 0 0; font-size: 13px; color: #374151; }
  
  /* Process Notes */
  .process-note { 
    margin: 12px 0; 
    font-size: 14px; 
    color: #374151;
    line-height: 1.5;
  }
  
  /* Checklist */
  .checklist-note { margin: 12px 0; font-size: 13px; color: #64748b; font-style: italic; }
  .ingredient-icon { text-align: left; width: 10%; }
  .checkbox-cell { text-align: center; width: 10%; font-size: 16px; }
  
  /* Page Footer */
  .page-footer { 
    margin-top: 40px; 
    padding-top: 20px; 
    border-top: 1px solid #e2e8f0; 
    text-align: center; 
    font-size: 12px; 
    color: #9ca3af; 
  }
  .page-footer p { margin: 0; }
  
  /* Icon Styling */
  .icon { 
    display: inline-block; 
    margin-right: 8px; 
    vertical-align: middle;
  }
  .icon svg {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    stroke-width: 2;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  
  /* Notes */
  .notes { 
    margin: 15px 0; 
    padding: 12px; 
    background: #f8fafc; 
    border-left: 4px solid #6366f1; 
    border-radius: 0 6px 6px 0; 
  }
  .notes h3 { margin: 0 0 6px; font-size: 14px; color: #1e293b; }
  .notes-content { font-size: 13px; color: #374151; line-height: 1.5; }
  .notes-content p { margin: 0 0 8px; }
  .notes-content p:last-child { margin-bottom: 0; }
  .notes-content h1, .notes-content h2, .notes-content h3 { margin: 8px 0 4px; font-weight: 600; }
  .notes-content h1 { font-size: 16px; }
  .notes-content h2 { font-size: 15px; }
  .notes-content h3 { font-size: 14px; }
  .notes-content strong { font-weight: 600; }
  .notes-content em { font-style: italic; }
  .notes-content code { background: #f1f5f9; padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 12px; }
  .notes-content pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin: 8px 0; overflow-x: auto; }
  .notes-content pre code { background: none; padding: 0; }
  .notes-content ul, .notes-content ol { margin: 4px 0; padding-left: 20px; }
  .notes-content li { margin: 2px 0; }
  .notes-content blockquote { 
    margin: 8px 0; 
    padding: 8px 12px; 
    border-left: 3px solid #d1d5db; 
    background: #f9fafb; 
    color: #4b5563; 
    font-style: italic; 
  }
  .notes-content hr { margin: 12px 0; border: none; border-top: 1px solid #e5e7eb; }
  .notes-content a { color: #3b82f6; text-decoration: underline; }
  .notes-content img { max-width: 100%; height: auto; margin: 8px 0; }
  .notes-content del { text-decoration: line-through; opacity: 0.7; }
  
  /* Markdown tables */
  .notes-content table,
  .recipe-description table,
  .markdown-table { 
    width: 100%; 
    border-collapse: collapse; 
    margin: 12px 0; 
    border: 1px solid #e2e8f0;
    table-layout: fixed;
  }
  .notes-content th, .notes-content td,
  .recipe-description th, .recipe-description td,
  .markdown-table th, .markdown-table td { 
    padding: 8px 12px; 
    border: 1px solid #e2e8f0; 
    text-align: left; 
    vertical-align: top;
    word-wrap: break-word;
  }
  .notes-content th,
  .recipe-description th,
  .markdown-table th { 
    background: #f1f5f9; 
    font-weight: 600; 
    font-size: 12px; 
  }
  .notes-content td,
  .recipe-description td,
  .markdown-table td { 
    font-size: 12px; 
  }
  
  /* Print Styles */
  @media print {
    .actions { display: none !important; }
    body { font-size: 12px; }
    .header h1 { font-size: 24px; }
    .section h2 { font-size: 18px; }
    .container { padding: 10px; }
    .overview { background: none; border: 1px solid #ccc; }
    .step, .water-profile, .style-info, .notes { 
      background: none !important; 
      border: 1px solid #ccc !important; 
    }
    .ingredients-table th { background: #f5f5f5; }
  }
`

async function generateRecipeHtml(recipe: PrintRecipeData, displayUnits: UnitSystem): Promise<string> {
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long', 
    day: 'numeric'
  })

  // Sort ingredients using custom logic (handle both unit systems)
  const sortedGrains = [...recipe.grains].sort((a, b) => {
    const weightA = getWeightValue(a, 'metric') || 0
    const weightB = getWeightValue(b, 'metric') || 0
    return weightB - weightA  // Descending by weight
  })
  
  // Sort hops by use type priority, then by time
  const hopSortPriority = {
    'mash': 1,
    'first_wort': 2,
    'boil': 3,
    'whirlpool': 4,
    'dry_hop': 5
  } as const
  
  const sortedHops = [...recipe.hops].sort((a, b) => {
    const priorityA = hopSortPriority[a.use_type as keyof typeof hopSortPriority] || 999
    const priorityB = hopSortPriority[b.use_type as keyof typeof hopSortPriority] || 999
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB
    }
    
    // Within same use type, sort by time
    if (a.use_type === 'boil' || a.use_type === 'first_wort' || a.use_type === 'whirlpool') {
      // For boil and whirlpool, higher time first (60min before 30min)
      return b.time_minutes - a.time_minutes
    } else {
      // For dry hop and mash, lower time first
      return a.time_minutes - b.time_minutes
    }
  })
  
  const sortedYeasts = [...recipe.yeasts].sort((a, b) => (a.yeasts?.name || '').localeCompare(b.yeasts?.name || '')) // Alphabetically by name
  
  const sortedMisc = [...recipe.misc].sort((a, b) => {
    const miscSortPriority = {
      'mash': 1,
      'boil': 2,
      'primary': 3,
      'secondary': 4,
      'bottling': 5,
      'aging': 6
    } as const
    
    const priorityA = miscSortPriority[a.use_type as keyof typeof miscSortPriority] || 999
    const priorityB = miscSortPriority[b.use_type as keyof typeof miscSortPriority] || 999
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB
    }
    
    // Within same use type, sort by name
    return (a.misc_ingredients?.name || '').localeCompare(b.misc_ingredients?.name || '')
  })
  const sortedMashSteps = [...recipe.mashSteps].sort((a, b) => a.step_order - b.step_order)
  const sortedFermentationSteps = [...recipe.fermentationSteps].sort((a, b) => a.step_order - b.step_order)
  
  // Calculate total grain weight in metric for calculations (always use kg internally)
  const totalGrainsKg = recipe.grains.reduce((sum, grain) => {
    const weightKg = getWeightValue(grain, 'metric') || 0
    return sum + weightKg
  }, 0)


  // Generate mash steps with water volume calculation
  const mashStepsHtml = sortedMashSteps.map((step, index) => {
    // Calculate mash water volume: grain weight × mash thickness
    const mashThickness = recipe.metadata.mash_thickness || recipe.metadata.mash_thickness_qt_per_lb ? conversions.mashThicknessToLPerKg(recipe.metadata.mash_thickness_qt_per_lb!) : 3
    const mashWaterVolumeLiters = totalGrainsKg * mashThickness
    const showWaterVolume = index === 0 // Only show water volume for first step
    
    // Format water volume for display
    const waterVolumeDisplay = displayUnits === 'imperial' 
      ? `${conversions.litersToGallons(mashWaterVolumeLiters).toFixed(2)} gal`
      : `${mashWaterVolumeLiters.toFixed(1)} L`
    
    const grainWeightDisplay = displayUnits === 'imperial'
      ? `${conversions.kgToLbs(totalGrainsKg).toFixed(1)} lbs`
      : `${totalGrainsKg.toFixed(2)} kg`
    
    const mashThicknessDisplay = formatMashThickness(recipe.metadata, displayUnits)
    
    return `
    <div class="step">
      <div class="step-number">${index + 1}</div>
      <div class="step-content">
        <h4>${htmlEscape(step.name)}</h4>
        <p><strong>${formatTemperature(step, displayUnits)} for ${step.duration_minutes} minutes</strong></p>
        ${showWaterVolume ? `<p class="water-volume"><strong>Water Volume:</strong> ${waterVolumeDisplay} (${grainWeightDisplay} × ${mashThicknessDisplay})</p>` : ''}
        ${step.description ? `<p class="step-description">${htmlEscape(step.description)}</p>` : ''}
      </div>
    </div>
  `}).join('')

  // Generate fermentation steps  
  const fermentationStepsHtml = sortedFermentationSteps.map((step, index) => `
    <div class="step">
      <div class="step-number">${index + 1}</div>
      <div class="step-content">
        <h4>${htmlEscape(step.name)}</h4>
        <p><strong>${formatTemperature(step, displayUnits)} for ${step.duration_days} days</strong></p>
        ${step.description ? `<p class="step-description">${htmlEscape(step.description)}</p>` : ''}
      </div>
    </div>
  `).join('')

  // Generate water treatment section with water agents
  const waterHtml = (() => {
    let html = ''
    
    // Add water profiles and salt additions
    if (recipe.water && recipe.water.length > 0) {
      html += recipe.water.map(water => {
        const salts = water.water_calculations?.salt_additions
        const saltRows = salts ? Object.entries(salts)
          .filter(([, value]) => value && value > 0)
          .map(([salt, amount]) => {
            const saltName = salt.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
              .replace(/caso4/i, 'CaSO₄')
              .replace(/cacl2/i, 'CaCl₂')
              .replace(/mgso4/i, 'MgSO₄')
              .replace(/nahco3/i, 'NaHCO₃')
              .replace(/nacl/i, 'NaCl')
        return `
        <tr>
          <td class="ingredient-name">${saltName}</td>
          <td class="ingredient-amount">${typeof amount === 'number' ? amount.toFixed(1) : amount}g</td>
        </tr>`
          }).join('') : ''
        
        return `
          <h4>${htmlEscape(water.name)} (${formatVolume(water, displayUnits)})</h4>
${generateIngredientTable(
            [{text: 'Treatment'}, {text: 'Amount', style: 'text-align: right; width: 20%;'}],
            saltRows ? saltRows.split('</tr>').filter(row => row.trim()).map(row => row + '</tr>') : [],
            'No salt additions needed'
          )}
          ${water.water_calculations?.water_analysis?.sulfate_chloride_balance ? 
            `<p class="water-note"><strong>Flavor Profile:</strong> ${htmlEscape(water.water_calculations.water_analysis.sulfate_chloride_balance)}</p>` : ''}
        `
      }).join('')
    }
    
    // Add water agents from misc ingredients with use_type: mash
    const waterAgents = sortedMisc.filter(misc => 
      misc.use_type === 'mash' && misc.misc_ingredients!.ingredient_type === 'water_agent'
    )
    
    if (waterAgents.length > 0) {
      const waterAgentRows = waterAgents.map(agent => `
        <tr>
          <td class="ingredient-name">${htmlEscape(agent.misc_ingredients!.name)}</td>
          <td class="ingredient-amount">${agent.amount_units} ${normalizeUnit(agent.unit_type)}</td>
        </tr>`).join('')
      
      html += `
        <h4>Additional Water Agents</h4>
${generateIngredientTable(
          [{text: 'Agent'}, {text: 'Amount', style: 'text-align: right; width: 20%;'}],
          waterAgentRows.split('</tr>').filter(row => row.trim()).map(row => row + '</tr>')
        )}
      `
    }
    
    return html || '<p>No water treatment specified</p>'
  })()

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(recipe.metadata.name)} - Brew Day Recipe</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${htmlEscape(recipe.metadata.name)}</h1>
      <div class="actions">
        <button id="printBtn" class="btn">🖨️ Print Recipe</button>
      </div>
    </div>

    ${recipe.metadata.description ? `
    <div class="recipe-description">
      ${await markdownToHtml(recipe.metadata.description)}
    </div>
    ` : ''}


    <h3 class="metrics-title">Target Metrics</h3>
    <div class="metrics-list">
      <div class="metrics-column">
        <div class="metric-item">
        <span class="metric-label">Batch size:</span>
        <span class="metric-value">${formatBatchSize(recipe.metadata, displayUnits)}</span>
        </div>
        <div class="metric-item">
        <span class="metric-label">Style Match:</span>
        <span class="metric-value">${recipe.metadata.beer_style ? `${htmlEscape(recipe.metadata.beer_style.number)} - ${htmlEscape(recipe.metadata.beer_style.name)}` : 'No style specified'}</span>
        </div>
        ${recipe.calculations?.calculated_og ? `
        <div class="metric-item">
          <span class="metric-label">Original Gravity (OG):</span>
          <span class="metric-value">${recipe.calculations.calculated_og.toFixed(3)}</span>
        </div>
        ` : ''}
        ${recipe.calculations?.calculated_fg ? `
        <div class="metric-item">
          <span class="metric-label">Final Gravity (FG):</span>
          <span class="metric-value">${recipe.calculations.calculated_fg.toFixed(3)}</span>
        </div>
        ` : ''}
        ${recipe.calculations?.calculated_abv ? `
        <div class="metric-item">
          <span class="metric-label">Alcohol by Volume (ABV):</span>
          <span class="metric-value">${recipe.calculations.calculated_abv.toFixed(1)}%</span>
        </div>
        ` : ''}
      </div>
      
      <div class="metrics-column">
        <div class="metric-item">
        <span class="metric-label">Efficiency:</span>
        <span class="metric-value">${recipe.metadata.efficiency_percent}%</span>
        </div>
        ${recipe.calculations?.calculated_ibu ? `
        <div class="metric-item">
          <span class="metric-label">International Bitterness Units (IBUs):</span>
          <span class="metric-value">${Math.round(recipe.calculations.calculated_ibu)}</span>
        </div>
        ` : ''}
        ${recipe.calculations?.calculated_ibu && recipe.calculations?.calculated_og ? `
        <div class="metric-item">
          <span class="metric-label">Bitterness Ratio (IBU / OG):</span>
          <span class="metric-value">${(() => {
            const ibu = recipe.calculations.calculated_ibu
            const og = recipe.calculations.calculated_og
            const denom = (og - 1) * 1000
            if (denom === 0) return 'N/A'
            const ratio = ibu / denom
            return ratio.toFixed(3)
          })()}</span>
        </div>
        ` : ''}
        ${recipe.calculations?.calculated_ebc || recipe.calculations?.calculated_srm ? `
        <div class="metric-item">
          <span class="metric-label">Colour - ${displayUnits === 'imperial' ? 'Standard Reference Method (SRM)' : 'European Brewery Convention (EBC)'}:</span>
          <span class="metric-value">${formatColor(recipe.calculations, displayUnits)}</span>
        </div>
        ` : ''}
      </div>
    </div>

    <div class="section">
      <h2><span class="icon"><svg viewBox="0 0 24 24"><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"></path><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"></path></svg></span> Water Treatment</h2>
      ${waterHtml}
    </div>

    <div class="section">
      <h2><span class="icon"><svg viewBox="0 0 24 24"><path d="M21.56 4.56a1.5 1.5 0 0 1 0 2.122l-.47.47a3 3 0 0 1-4.212-.03 3 3 0 0 1 0-4.243l.44-.44a1.5 1.5 0 0 1 2.121 0z"></path><path d="m9 15 7.879-7.878"></path><rect style="fill:none;stroke:currentColor;stroke-width:1.747;stroke-linecap:round;stroke-linejoin:round" width="5.236" height="7.628" x="14.45" y="3.118" transform="matrix(0.6237,0.7817,-0.7092,0.705,0,0)"/></svg></span> Mash Steps</h2>
      <div class="steps">
        ${mashStepsHtml}
      </div>
      
${(() => {
        const mashRows = []
        
        // All grains go in mash
        mashRows.push(...sortedGrains.map(grain => `
          <tr>
                <td class="ingredient-name">${htmlEscape(grain.grains!.name)}</td>
            <td class="ingredient-amount">${formatWeight(grain, displayUnits)}</td>
          </tr>
        `))
        
        // Hops with use_type: mash
        const mashHops = sortedHops.filter(hop => hop.use_type === 'mash')
        mashRows.push(...mashHops.map(hop => `
          <tr>
            <td class="ingredient-name">${htmlEscape(hop.hops!.name)}</td>
            <td class="ingredient-amount">${formatWeight(hop, displayUnits)}</td>
          </tr>
        `))
        
        // Misc ingredients with use_type: mash (excluding water agents already shown in water section)
        const mashMisc = sortedMisc.filter(misc => 
          misc.use_type === 'mash' && misc.misc_ingredients!.ingredient_type !== 'water_agent'
        )
        mashRows.push(...mashMisc.map(misc => `
          <tr>
            <td class="ingredient-name">${htmlEscape(misc.misc_ingredients!.name)}</td>
            <td class="ingredient-amount">${misc.amount_units} ${normalizeUnit(misc.unit_type)}</td>
          </tr>
        `))
        
        return generateIngredientTable(
          [{text: 'Ingredient'}, {text: 'Amount', style: 'text-align: right; width: 20%;'}],
          mashRows,
          'No mash ingredients'
        )
      })()}
    </div>

    <div class="section">
      <h2><span class="icon"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/></svg></span> Boil Schedule (${recipe.metadata.boil_time_minutes} min)</h2>
      <p class="process-note">Sparge to achieve desired pre-boil volume (${formatBatchSize(recipe.metadata, displayUnits)} batch size + typically ${displayUnits === 'imperial' ? '1.3-2.6 gal' : '5-10L'} to allow for boil-off, kettle trub, shrinkage, deadspace and chiller/line losses depending on your system).</p>
      
${(() => {
        // Get boil ingredients in the order they should be added: first wort, boil, whirlpool
        const boilTypeOrder = ['first_wort', 'boil', 'whirlpool'] as const
        const boilRows: string[] = []
        
        // Add ingredients by type priority, with proper time sorting within each type
        boilTypeOrder.forEach(useType => {
          // Combine all ingredients of this use type
          const ingredientsOfType: Array<typeof sortedHops[0] | typeof sortedMisc[0]> = [
            ...sortedHops.filter(hop => hop.use_type === useType),
            ...sortedMisc.filter(misc => misc.use_type === useType)
          ]
          
          // Sort by time within the use type (descending for boil types, ascending for others)
          const sortedIngredients = ingredientsOfType.sort((a, b) => {
            const timeA = a.time_minutes || 0
            const timeB = b.time_minutes || 0
            return useType === 'first_wort' || useType === 'boil' ? timeB - timeA : timeA - timeB
          })
          
          // Generate rows for this use type
          sortedIngredients.forEach(ingredient => {
            if ('amount_grams' in ingredient) {
              // This is a hop
              const hop = ingredient as RecipeHop
              const alphaAcid = hop.alpha_acid_percent_override || hop.hops!.alpha_acid_percent
              boilRows.push(`
                <tr>
                  <td class="ingredient-name">${htmlEscape(hop.hops!.name)}</td>
                  <td class="ingredient-details">${formatHopTimingForPrint(hop)} • ${alphaAcid}% AA</td>
                  <td class="ingredient-amount">${formatWeight(hop, displayUnits)}</td>
                </tr>
              `)
            } else {
              // This is a misc ingredient
              const misc = ingredient as RecipeMisc
              boilRows.push(`
                <tr>
                  <td class="ingredient-name">${htmlEscape(misc.misc_ingredients!.name)}</td>
                  <td class="ingredient-details">${formatMiscTimingForPrint(misc)} • ${htmlEscape(misc.misc_ingredients!.ingredient_type)}</td>
                  <td class="ingredient-amount">${misc.amount_units} ${normalizeUnit(misc.unit_type)}</td>
                </tr>
              `)
            }
          })
        })
        
        return generateIngredientTable(
          [{text: 'Ingredient'}, {text: 'Timing & Details'}, {text: 'Amount', style: 'text-align: right; width: 20%;'}],
          boilRows,
          'No boil additions'
        )
      })()}
    </div>

    <div class="section">
      <h2><span class="icon"><svg viewBox="0 0 24 24"><path d="M 5,21 V 5 C 5,3.8954305 5.8954305,3 7,3 h 10 c 1.104569,0 2,0.8954305 2,2 v 16"/><path d="M 5,13 V 5 C 5,3.8954305 5.8954305,3 7,3 h 10 c 1.104569,0 2,0.8954305 2,2 v 16"/><path d="M 19,13 12,20.862266 5,13 V 5 C 5,3.8954305 5.8954305,3 7,3 h 10 c 1.104569,0 2,0.8954305 2,2 z"/></svg></span> Fermentation</h2>
      <div class="steps">
        ${fermentationStepsHtml}
      </div>
      
${(() => {
        const fermentationRows = []
        
        // Yeast
        fermentationRows.push(...sortedYeasts.map(yeast => `
          <tr>
            <td class="ingredient-name">${htmlEscape(yeast.yeasts!.name)}</td>
            <td class="ingredient-details">${htmlEscape(yeast.yeasts!.yeast_type)} • ${yeast.yeasts!.attenuation_percent}% attenuation</td>
            <td class="ingredient-amount">${yeast.amount_units} ${normalizeUnit(yeast.unit_type)}</td>
          </tr>
        `))
        
        // Fermentation additions (primary, secondary)
        const fermentationMisc = sortedMisc.filter(misc => 
          ['primary', 'secondary'].includes(misc.use_type)
        )
        fermentationRows.push(...fermentationMisc.map(misc => `
          <tr>
            <td class="ingredient-name">${htmlEscape(misc.misc_ingredients!.name)}</td>
            <td class="ingredient-details">${formatMiscTimingForPrint(misc)} • ${htmlEscape(misc.misc_ingredients!.ingredient_type)}</td>
            <td class="ingredient-amount">${misc.amount_units} ${normalizeUnit(misc.unit_type)}</td>
          </tr>
        `))
        
        // Dry hops
        const dryHops = sortedHops.filter(hop => hop.use_type === 'dry_hop')
        fermentationRows.push(...dryHops.map(hop => {
          return `
            <tr>
              <td class="ingredient-name">${htmlEscape(hop.hops!.name)}</td>
              <td class="ingredient-details">${formatHopTimingForPrint(hop)}</td>
              <td class="ingredient-amount">${formatWeight(hop, displayUnits)}</td>
            </tr>
          `
        }))
        
        return generateIngredientTable(
          [{text: 'Ingredient'}, {text: 'Details'}, {text: 'Amount', style: 'text-align: right; width: 20%;'}],
          fermentationRows,
          'No fermentation ingredients'
        )
      })()}
    </div>

    ${(() => {
      // Bottling and aging section (only if there are relevant ingredients)
      const bottlingIngredients = sortedMisc.filter(misc => 
        ['bottling', 'aging'].includes(misc.use_type)
      )
      
      if (bottlingIngredients.length === 0) return ''
      
      return `
      <div class="section">
        <h2><span class="icon"><svg viewBox="0 0 24 24"><path d="M3 13h8"></path><path d="M5 7s-2 3-2 6a4 4 0 0 0 8 0c0-3-2-6-2-6Z"></path><path d="M7 17v5"></path><path d="M4 22h6"></path><path d="M18 4c0 3-3 3-3 6v11c0 .6.4 1 1 1h4c.6 0 1-.4 1-1V10c0-3-3-3-3-6"></path><path d="M18 4V2"></path></svg></span> Bottling & Aging</h2>
        ${generateIngredientTable(
          [{text: 'Ingredient'}, {text: 'Details'}, {text: 'Amount', style: 'text-align: right; width: 20%;'}],
          bottlingIngredients.map(misc => `
            <tr>
              <td class="ingredient-name">${htmlEscape(misc.misc_ingredients!.name)}</td>
              <td class="ingredient-details">${formatMiscTimingForPrint(misc)} • ${htmlEscape(misc.misc_ingredients!.ingredient_type)}</td>
              <td class="ingredient-amount">${misc.amount_units} ${normalizeUnit(misc.unit_type)}</td>
            </tr>
          `)
        )}
      </div>
      `
    })()}

    <div class="section">
      <h2><span class="icon"><svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z"></path></svg></span> Ingredients Checklist</h2>
      <p class="checklist-note">Use this as a shopping list. Quantities shown are the total amounts needed.</p>
${(() => {
        const checklist: Array<{type: string, name: string, amount: string, icon: string}> = []
        
        // Consolidate grains
        const grainTotals = new Map()
        sortedGrains.forEach(grain => {
          const key = grain.grains!.name
          const weightKg = getWeightValue(grain, 'metric') || 0
          grainTotals.set(key, (grainTotals.get(key) || 0) + weightKg)
        })
        grainTotals.forEach((amountKg, name) => {
          const displayAmount = displayUnits === 'imperial'
            ? `${conversions.kgToLbs(amountKg).toFixed(1)} lbs`
            : `${amountKg.toFixed(2)} kg`
          checklist.push({
            type: 'grain',
            name: name,
            amount: displayAmount,
            icon: '<svg viewBox="0 0 24 24"><path d="M2 22 16 8"></path><path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"></path><path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"></path><path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"></path><path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z"></path><path d="M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"></path><path d="M15.47 13.47 17 15l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"></path><path d="M19.47 9.47 21 11l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L13 11l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"></path></svg>'
          })
        })
        
        // Consolidate hops
        const hopTotals = new Map()
        sortedHops.forEach(hop => {
          const key = hop.hops!.name
          const weightGrams = (hop.amount_grams || (hop.amount_oz ? conversions.ozToGrams(hop.amount_oz) : 0))
          hopTotals.set(key, (hopTotals.get(key) || 0) + weightGrams)
        })
        hopTotals.forEach((amountGrams, name) => {
          const displayAmount = displayUnits === 'imperial'
            ? `${conversions.gramsToOz(amountGrams).toFixed(1)} oz`
            : `${amountGrams.toFixed(1)} g`
          checklist.push({
            type: 'hop',
            name: name,
            amount: displayAmount,
            icon: '<svg viewBox="0 0 24 24"><path d="M10.82 16.12c1.69.6 3.91.79 5.18.85.55.03 1-.42.97-.97-.06-1.27-.26-3.5-.85-5.18"></path><path d="M11.5 6.5c1.64 0 5-.38 6.71-1.07.52-.2.55-.82.12-1.17A10 10 0 0 0 4.26 18.33c.35.43.96.4 1.17-.12.69-1.71 1.07-5.07 1.07-6.71 1.34.45 3.1.9 4.88.62a.88.88 0 0 0 .73-.74c.3-2.14-.15-3.5-.61-4.88"></path><path d="M15.62 16.95c.2.85.62 2.76.5 4.28a.77.77 0 0 1-.9.7 16.64 16.64 0 0 1-4.08-1.36"></path><path d="M16.13 21.05c1.65.63 3.68.84 4.87.91a.9.9 0 0 0 .96-.96 17.68 17.68 0 0 0-.9-4.87"></path><path d="M16.94 15.62c.86.2 2.77.62 4.29.5a.77.77 0 0 0 .7-.9 16.64 16.64 0 0 0-1.36-4.08"></path><path d="M17.99 5.52a20.82 20.82 0 0 1 3.15 4.5.8.8 0 0 1-.68 1.13c-2.33.2-5.3-.32-8.27-1.57"></path><path d="M4.93 4.93 3 3a.7.7 0 0 1 0-1"></path><path d="M9.58 12.18c1.24 2.98 1.77 5.95 1.57 8.28a.8.8 0 0 1-1.13.68 20.82 20.82 0 0 1-4.5-3.15"></path></svg>'
          })
        })
        
        // Add yeast
        sortedYeasts.forEach(yeast => {
          checklist.push({
            type: 'yeast',
            name: yeast.yeasts!.name,
            amount: `${yeast.amount_units} ${normalizeUnit(yeast.unit_type)}`,
            icon: '<svg viewBox="0 0 24 24"><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"></path><path d="M6.453 15h11.094"></path><path d="M8.5 2h7"></path></svg>'
          })
        })
        
        // Consolidate misc ingredients
        const miscTotals = new Map()
        sortedMisc.forEach(misc => {
          const key = misc.misc_ingredients!.name + '|' + misc.unit_type
          const currentAmount = miscTotals.get(key) || { amount: 0, name: misc.misc_ingredients!.name, unit: misc.unit_type }
          currentAmount.amount += misc.amount_units
          miscTotals.set(key, currentAmount)
        })
        miscTotals.forEach((data) => {
          checklist.push({
            type: 'misc',
            name: data.name,
            amount: `${data.amount} ${normalizeUnit(data.unit)}`,
            icon: '<svg viewBox="0 0 24 24"><path d="M10 15h4"></path><path d="m14.817 10.995-.971-1.45 1.034-1.232a2 2 0 0 0-2.025-3.238l-1.82.364L9.91 3.885a2 2 0 0 0-3.625.748L6.141 6.55l-1.725.426a2 2 0 0 0-.19 3.756l.657.27"></path><path d="m18.822 10.995 2.26-5.38a1 1 0 0 0-.557-1.318L16.954 2.9a1 1 0 0 0-1.281.533l-.924 2.122"></path><path d="M4 12.006A1 1 0 0 1 4.994 11H19a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"></path></svg>'
          })
        })
        
        const checklistRows = checklist.map(item => `
          <tr>
            <td class="ingredient-icon"><span class="icon">${item.icon}</span></td>
            <td class="ingredient-name">${htmlEscape(item.name)}</td>
            <td class="ingredient-amount">${item.amount}</td>
            <td class="checkbox-cell">☐</td>
          </tr>
        `)
        
        return generateIngredientTable(
          [
            {text: 'Type', style: 'width: 10%; text-align: left;'},
            {text: 'Ingredient'},
            {text: 'Total Amount', style: 'text-align: right; width: 20%;'},
            {text: '✓', style: 'width: 10%; text-align: center;'}
          ],
          checklistRows
        )
      })()}
    </div>

    ${recipe.metadata.brewing_notes ? `
    <div class="notes">
      <h3><span class="icon"><svg viewBox="0 0 24 24"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"></path><path d="M2 6h4"></path><path d="M2 10h4"></path><path d="M2 14h4"></path><path d="M2 18h4"></path><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a .5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"></path></svg></span>Brewing Notes</h3>
      <div class="notes-content">${await markdownToHtml(recipe.metadata.brewing_notes)}</div>
    </div>
    ` : ''}

    ${recipe.metadata.tasting_notes ? `
    <div class="notes">
      <h3><span class="icon"><svg viewBox="0 0 24 24"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"></path><path d="M2 6h4"></path><path d="M2 10h4"></path><path d="M2 14h4"></path><path d="M2 18h4"></path><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a .5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"></path></svg></span>Tasting Notes</h3>
      <div class="notes-content">${await markdownToHtml(recipe.metadata.tasting_notes)}</div>
    </div>
    ` : ''}

    <div class="page-footer">
      <p>Generated by Brewey.ai on ${currentDate}</p>
    </div>
  </div>

  <script>
  (function(){
    function setupPrint() {
      try {
        var printBtn = document.getElementById('printBtn');
        if (printBtn) {
          printBtn.addEventListener('click', function() {
            window.print();
          });
        }
      } catch (e) {
        try { console.warn('Failed to setup print button', e); } catch(_) {}
      }
    }
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupPrint);
    } else {
      setupPrint();
    }
  })();
  </script>
</body>
</html>`

  return html
}

export const printCommand: SlashCommandHandler = {
  name: 'print',
  type: 'system',
  description: 'Generate a print friendly recipe for brew day',
  usage: '/print',
  
  execute: async (): Promise<SlashCommandResult> => {
    try {
      const currentRecipeId = useChatStore.getState().currentRecipeContext
      
      if (!currentRecipeId) {
        return {
          success: false,
          message: '⚠️ **No recipe selected**\n\nPlease select a recipe first before printing.',
          shouldAddToChat: true,
          messageType: 'error'
        }
      }

      // Get recipe data from local store
      const recipeState = useRecipeStore.getState()
      
      // Check if we have the right recipe loaded
      if (recipeState.selectedRecipeId !== currentRecipeId) {
        return {
          success: false,
          message: '⚠️ **Recipe not loaded**\n\nThe selected recipe data is not available. Please wait for the recipe to load and try again.',
          shouldAddToChat: true,
          messageType: 'error'
        }
      }

      if (!recipeState.recipeMetadata) {
        return {
          success: false,
          message: '⚠️ **Recipe data not available**\n\nRecipe information is not loaded. Please select a recipe and try again.',
          shouldAddToChat: true,
          messageType: 'error'
        }
      }

      // Build recipe data from local store - much simpler now!
      const recipeData: PrintRecipeData = {
        metadata: recipeState.recipeMetadata,
        grains: recipeState.grains,
        hops: recipeState.hops,
        yeasts: recipeState.yeasts,
        misc: recipeState.misc,
        water: recipeState.water,
        mashSteps: recipeState.mashSteps,
        fermentationSteps: recipeState.fermentationSteps,
        calculations: recipeState.calculations
      }

      // Generate and open HTML with user's unit preference
      const html = await generateRecipeHtml(recipeData, recipeState.displayUnits)
      
      if (typeof window === 'undefined') {
        return {
          success: false,
          message: '❌ **Browser required**\n\nThis command requires a browser environment.',
          shouldAddToChat: true,
          messageType: 'error'
        }
      }

      try {
        const blob = new Blob([html], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        const newWindow = window.open('', '_blank')
        if (newWindow) {
          try { newWindow.opener = null } catch {}
          newWindow.location.href = url
        } else {
          // Fallback for blocked popups
          const a = document.createElement('a')
          a.href = url
          a.download = `${recipeData.metadata.name.replace(/[^a-zA-Z0-9]/g, '_')}-brew-day.html`
          a.rel = 'noopener'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        }
      } catch (e) {
        return {
          success: false,
          message: `❌ **Failed to open recipe**: ${e instanceof Error ? e.message : 'Unknown error'}`,
          shouldAddToChat: true,
          messageType: 'error'
        }
      }

      return {
        success: true,
        message: '🍺 **Brew day recipe opened**\n\nA new tab was opened with your formatted recipe. Click the "Print Recipe" button or use Ctrl+P (Cmd+P on Mac) to print or save as PDF.',
        shouldAddToChat: true,
        messageType: 'success'
      }
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to generate recipe: ${error instanceof Error ? error.message : 'Unknown error'}`,
        shouldAddToChat: true,
        messageType: 'error'
      }
    }
  }
}