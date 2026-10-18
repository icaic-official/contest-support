# Write Minsky documentation

Apply the user's `unslop` and `technical-writing` rules to new and revised documentation.
Use these rules for README text, review descriptions, and commit messages too.
Preserve exact code names, commands, paths, and recorded evidence.

## Choose one page type

Choose the page type before writing:

- Write a tutorial for a guided first success. State the result and show the expected output after each step.
- Write a how-to guide for a reader who already understands the task. Give the steps and link to background material.
- Write reference material for facts, settings, limits, and errors. Describe the implementation without instructions or persuasion.
- Write an explanation for a design choice. Keep the topic bounded and explain the reasons.

Separate pages that mix these purposes. Link each page to the related material.
Use sentence case for headings. Name task guides with a verb, such as "Configure Cloudflare builds".

## Write exact instructions

Address the reader as "you". Use direct commands and the present tense.
Put a condition before the instruction it controls.
Give one instruction per sentence and retain articles such as "the" and "a".
Split instructions longer than about 20 words and descriptions longer than about 25 words when that improves clarity.
Keep a longer sentence when its condition belongs with its result.

Use numbered lists for ordered steps and bullets for unordered items.
Introduce each list with a complete sentence.
Use code formatting for symbols and commands. Use bold for interface labels.
Indent nested code examples with tabs.
Use actual paths and include the command that reproduces a documented count.

## Remove ambiguous wording

Name the actor. Keep "only" and "not" beside the words they qualify.
Repeat a noun when a pronoun could refer to two things.
Keep one term for each concept and one verb for each action.
Use the words in the codebase instead of inventing new labels.
Write "and", "or", or "both" instead of joining prose alternatives with a slash.
Preserve slashes inside real paths, commands, and identifiers.

## Remove filler and writing patterns

Apply the supplied `unslop` rules before review:

- Delete filler, decorative phrases, forced groups of three, and generic conclusions.
- Replace abstract metaphors and inflated words with the action or object they describe.
- Replace vague claims with a named source, an observed result, or a precise limitation.
- Preserve uncertainty when the evidence is incomplete. Remove stacked hedges without inventing certainty.
- Use straight quotes and sentence case. Avoid decorative emojis and unnecessary bold labels.
- Use periods or commas instead of dash punctuation or parenthetical asides.
- Use colons before lists or examples, not to join clauses.
- Write complete sentences. Do not replace words with arrows or compressed fragments.

Read the text aloud after editing. Vary sentence length when the facts permit it.
If a sentence gives no Minsky-specific fact, instruction, or necessary context, remove it.

## Review the result

Check the text against the source revision and the reader's task.
Check each command's prerequisites, directory, target, and expected result.
Keep verified behavior separate from proposals and unverified claims.
Preserve dated records without rewriting them as current instructions.

Keep a PR description short enough to read in under a minute.
State the problem, the change, and the relevant checks. Link to detailed evidence instead of copying run logs or revision lists.
Review descriptions and commit messages use the same sentence rules. They do not need a Diataxis page type.
