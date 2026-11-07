# Brewing calculations

`calculateRecipe(metricRecipe)` accepts the repository's nested recipe shape and returns `calculated_og`, `calculated_fg`, `calculated_abv`, `calculated_ibu`, and `calculated_ebc`. It is synchronous and performs no database, filesystem, network or model calls. All values enter in metric units; convert imperial arguments at the shared service boundary before storing them.

The port follows the final, deployed PostgreSQL functions, rather than older copies of similarly named functions in migration history:

- OG applies recipe efficiency only to fermentables whose `must_mash` flag is true. Extracts/sugars use full potential. OG is rounded to three decimals before downstream calculations.
- FG uses the arithmetic mean of yeast attenuations, regardless of yeast quantities; its default is 75%. Mash steps count only from 62–72°C, weighted by duration. The 20/30-minute boundaries, temperature adjustment clamps, short-mash penalty and final 50–95% attenuation clamp match SQL. FG rounds to three decimals.
- ABV uses rounded OG/FG and the 131.25 factor, then rounds to two decimals.
- IBU uses Tinseth's gravity/time factors, form multipliers, alpha overrides including zero, first-wort recipe boil duration/bonus, and the legacy stepped whirlpool temperature factors. Dry/mash additions contribute no bitterness. IBU rounds to one decimal.
- EBC uses the final Morey implementation with metric MCU factor 4.236, exponent 0.6859, coefficient 1.4922 and SRM/EBC factor 1.97. EBC rounds to one decimal.

PostgreSQL's decimal rounding is half-away-from-zero. Missing/invalid batch volume produces null calculations; the old schema rejected non-positive batch volume, so the pure domain boundary guards those invalid inputs instead of producing Infinity. Missing joined catalogue rows are skipped, corresponding to SQL's inner joins. Unknown extract data propagates null gravity; unknown colour is skipped. Valid persisted rows are the parity contract.

`calculateWater(metricWater)` returns the legacy `water_calculations` object. A missing/null base ion leaves calculations null; zero is a known value. Five salts and six ions define a nonnegative least-squares problem. Enumerating its 32 active sets yields the same optimum as the legacy quadratic-programming solver, without a runtime dependency. Display salt weights round to one decimal, while the achieved profile/deviations use precise additions. Alkalinity, hardness, sulfate/chloride balance and colour guidance preserve the legacy behavior, including ratio zero in the MCP object when chloride is absent. Invalid complete profiles retain the legacy failure shape. Attribution/license for the original MIT water implementation is in `water.LICENSE`.

## Evidence and tests

`fixtures/postgres.json` contains 41 synthetic reference cases and calculation fingerprints. `fixtures/water.json` contains 11 synthetic water-optimizer cases. They contain no user/database exports. These fixtures protect calculation and import compatibility without requiring a hosted service.

All fixture outputs match exactly. Additional tests cover null/zero values, decimal half rounding, unknown base water, precise-versus-displayed salts and input immutability. Run from the repository root with Node 24:

```sh
node --test --test-isolation=none frontend/src/lib/domain/__tests__/*.node.mjs
```
