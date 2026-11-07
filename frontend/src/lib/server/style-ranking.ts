/* eslint-disable @typescript-eslint/no-explicit-any */
// Deterministic ranking and parameter analysis preserved from the reference backend.
export function calculateVitalStatsScore(calculatedValues: any, style: any): number {
    const recipe = { og: calculatedValues?.og, fg: calculatedValues?.fg, abv: calculatedValues?.abv, ibu: calculatedValues?.ibu, ebc: calculatedValues?.ebc };
    const parameters = [
        { name: 'og', value: recipe.og, min: style.og_min, max: style.og_max },
        { name: 'fg', value: recipe.fg, min: style.fg_min, max: style.fg_max },
        { name: 'abv', value: recipe.abv, min: style.abv_min, max: style.abv_max },
        { name: 'ibu', value: recipe.ibu, min: style.ibu_min, max: style.ibu_max },
        { name: 'ebc', value: recipe.ebc, min: style.ebc_min, max: style.ebc_max }
    ];
    let totalScore = 0;
    let validParameters = 0;
    for (const param of parameters) {
        if (param.value == null || param.min == null || param.max == null)
            continue;
        validParameters++;
        if (param.value >= param.min && param.value <= param.max)
            totalScore += 1.0;
        else {
            const rangeSize = param.max - param.min;
            const deviation = param.value < param.min ? (param.min - param.value) : (param.value - param.max);
            const proximityScore = Math.max(0, 1.0 - (deviation / rangeSize));
            totalScore += proximityScore;
        }
    }
    return validParameters > 0 ? totalScore / validParameters : 0;
}
export function calculateTextScore(keywords: string[], style: any): number {
    const validKeywords = keywords.filter((k: any) => k && typeof k === 'string' && k.trim().length > 0);
    if (validKeywords.length === 0)
        return 0;
    const searchText = [style.name, style.category, style.overall_impression, style.characteristic_ingredients, style.tags, style.aroma, style.flavor].filter(Boolean).join(' ').toLowerCase();
    let weightedScore = 0;
    for (const keyword of validKeywords) {
        const lowerKeyword = keyword.toLowerCase().trim();
        if (lowerKeyword.length < 2)
            continue;
        if (style.name?.toLowerCase().includes(lowerKeyword))
            weightedScore += 1.0;
        else if (style.category?.toLowerCase().includes(lowerKeyword))
            weightedScore += 0.8;
        else if (style.tags?.toLowerCase().includes(lowerKeyword))
            weightedScore += 0.6;
        else if (searchText.includes(lowerKeyword))
            weightedScore += 0.4;
    }
    return Math.min(1.0, weightedScore / validKeywords.length);
}
export function calculateTieredRanking(vitalScore: number, textScore: number, hasVitalStats: boolean) {
    let tier: number;
    let finalScore: number;
    let reasoning: string;
    if (hasVitalStats && vitalScore === 1.0) {
        tier = 1;
        finalScore = 1.0 + (textScore * 0.1);
        reasoning = "Perfect vital statistics match";
    }
    else if (!hasVitalStats && textScore >= 0.8) {
        tier = 2;
        finalScore = 0.85 + (textScore * 0.15);
        reasoning = "Strong specialty style match";
    }
    else if (hasVitalStats && vitalScore >= 0.8) {
        tier = 3;
        finalScore = vitalScore + (textScore * 0.2);
        reasoning = "Good vital statistics match";
    }
    else if (hasVitalStats && vitalScore >= 0.6) {
        tier = 4;
        finalScore = (vitalScore * 0.7) + (textScore * 0.3);
        reasoning = "Decent vital statistics match";
    }
    else if (!hasVitalStats && textScore >= 0.5) {
        tier = 5;
        finalScore = textScore * 0.6;
        reasoning = "Moderate specialty match";
    }
    else {
        tier = 6;
        finalScore = (vitalScore * 0.5) + (textScore * 0.3);
        reasoning = "Weak match";
    }
    return { tier, finalScore, reasoning };
}
function getParameterUnit(paramName: string): string {
    switch (paramName) {
        case 'og':
        case 'fg':
            return 'points';
        case 'abv':
            return '%';
        case 'ibu':
            return 'IBU';
        case 'ebc':
            return 'EBC';
        default:
            return '';
    }
}
// Convert specific gravity to gravity points (1.053 -> 53)
// This is essential for meaningful deviation calculations in brewing
function sgToPoints(sg: number): number {
    return Math.round((sg - 1) * 1000);
}
// Get appropriate decimal precision for each parameter type
function getParameterPrecision(paramName: string): number {
    switch (paramName) {
        case 'og':
        case 'fg':
        case 'ibu':
            return 0; // Whole numbers
        case 'abv':
        case 'ebc':
            return 1; // 1 decimal place
        default:
            return 1;
    }
}
export function calculateParameterAnalysis(calculatedValues: any, style: any) {
    const recipe = { og: calculatedValues?.og, fg: calculatedValues?.fg, abv: calculatedValues?.abv, ibu: calculatedValues?.ibu, ebc: calculatedValues?.ebc };
    const parameters = [
        { name: 'og', value: recipe.og, min: style.og_min, max: style.og_max },
        { name: 'fg', value: recipe.fg, min: style.fg_min, max: style.fg_max },
        { name: 'abv', value: recipe.abv, min: style.abv_min, max: style.abv_max },
        { name: 'ibu', value: recipe.ibu, min: style.ibu_min, max: style.ibu_max },
        { name: 'ebc', value: recipe.ebc, min: style.ebc_min, max: style.ebc_max }
    ];
    const parameterAnalysis: any = {};
    for (const param of parameters) {
        if (param.value == null || param.min == null || param.max == null)
            continue;
        const range = [param.min, param.max];
        if (param.value >= param.min && param.value <= param.max) {
            parameterAnalysis[param.name] = { value: param.value, range, status: 'within_range' };
        }
        else {
            // For gravity values (OG/FG), convert to gravity points for meaningful deviation calculation
            let deviation: number;
            let deviationValue: number;
            let baseValue: number;
            if (param.name === 'og' || param.name === 'fg') {
                // Convert SG values to gravity points for calculation
                const valuePoints = sgToPoints(param.value);
                const minPoints = sgToPoints(param.min);
                const maxPoints = sgToPoints(param.max);
                deviation = param.value < param.min ? (minPoints - valuePoints) : (valuePoints - maxPoints);
                deviationValue = Math.abs(deviation);
                // Use boundary value as base for percentage calculation
                baseValue = param.value < param.min ? minPoints : maxPoints;
            }
            else {
                // For other parameters, use raw values
                deviation = param.value < param.min ? (param.min - param.value) : (param.value - param.max);
                deviationValue = Math.abs(deviation);
                // Use boundary value as base for percentage calculation
                baseValue = param.value < param.min ? param.min : param.max;
            }
            const deviationPercent = Math.round((deviationValue / baseValue) * 100);
            const precision = getParameterPrecision(param.name);
            const deviationText = param.value < param.min
                ? `${deviationValue.toFixed(precision)} ${getParameterUnit(param.name)} lower than target (${deviationPercent}% under min)`
                : `${deviationValue.toFixed(precision)} ${getParameterUnit(param.name)} higher than target (${deviationPercent}% over max)`;
            parameterAnalysis[param.name] = { value: param.value, range, status: param.value < param.min ? 'under_range' : 'over_range', deviation: deviationText };
        }
    }
    return parameterAnalysis;
}
