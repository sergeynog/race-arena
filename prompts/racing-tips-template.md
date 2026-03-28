=== DRIVER RACING TIPS UPDATE ===

You are updating the driver's personal racing tips — a living document that evolves after each analysis session.

{{DRIVER_CONTEXT}}

=== PREVIOUS TIPS (may be empty if first session) ===
{{PREVIOUS_TIPS}}

=== LATEST COACHING REPORT ===
{{LATEST_REPORT}}

=== ANALYSIS COUNT ===
This is analysis #{{ANALYSIS_COUNT}} for this driver.

=== INSTRUCTIONS ===

Synthesize the previous tips with the latest coaching report into an updated racing tips document. The tips belong to the driver identified above — all advice should be written FOR them.

IMPORTANT: If the analysis compared laps from different drivers, attribute insights correctly. Use "compared to @driver_name" when referencing benchmarks.

Write in PARAGRAPHS (not bullet points). Be specific and reference exact data from analyses.

Output EXACTLY these three sections in markdown:

## What to Work On

2-3 paragraphs describing the most important things the driver should focus on RIGHT NOW. Reference specific corners, distances, and speeds from the analyses. Describe the pattern across sessions — e.g. "Across your last N analyses, we've consistently seen you brake 15-20m earlier than the benchmark into Corners 3 and 7. Your entry speed averages 104 km/h vs 128 km/h at the benchmark, and you're coasting through the mid-corner instead of maintaining speed. The mental cue: hold the brakes 2 car lengths deeper and trust the grip."

Each focus area should include a concrete, memorable mental cue for the track.

## Patterns We're Seeing

2-3 paragraphs about habits — good and bad — that show up across multiple sessions. Be specific: describe which corners, how often, by how much. Reference the number of analyses this has appeared in. E.g. "In all 4 analyses so far, your throttle application out of slow corners (specifically Corners 2, 6, and 9) has been consistently aggressive — you're picking up throttle 8-12m before the benchmark, which is translating to 4-6 km/h higher exit speeds each time."

## Your Progress

2-3 paragraphs tracking what's getting better over time with specific numbers. Reference where the driver started vs where they are now. E.g. "When you first started, your Turn 3 entry was 98 km/h and you were braking at 160m. In your latest session, you've pushed that to 112 km/h with a brake point of 148m — a 14 km/h gain and 12m later braking. That alone is worth an estimated 0.3s per lap."

If this is the first analysis, establish the baseline and note what to watch going forward.
