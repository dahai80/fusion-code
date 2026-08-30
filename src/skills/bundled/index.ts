import { feature } from 'bun:bundle'
import { shouldAutoEnableClaudeInChrome } from 'src/utils/claudeInChrome/setup.js'
import { registerBatchSkill } from './batch.js'
import { registerBrainstormSkill } from './brainstorm.js'
import { registerCodeReviewSkill } from './codeReview.js'
import { registerFinishingBranchSkill } from './finishingBranch.js'
import { registerSantaLoopSkill } from './santaLoop.js'
import { registerSystematicDebuggingSkill } from './systematicDebugging.js'
import { registerTddSkill } from './tdd.js'
import { registerWritingPlansSkill } from './writingPlans.js'
import { registerVerifyCompleteSkill } from './verifyComplete.js'
import { registerMemorySaveSkill } from './memorySave.js'
import { registerClaudeInChromeSkill } from './claudeInChrome.js'
import { registerDatavizSkill } from './dataviz.js'
import { registerDebugSkill } from './debug.js'
import { registerKeybindingsSkill } from './keybindings.js'
import { registerLoremIpsumSkill } from './loremIpsum.js'
import { registerRememberSkill } from './remember.js'
import { registerSimplifySkill } from './simplify.js'
import { registerSddSkill } from './sdd.js'
import { registerSkillifySkill } from './skillify.js'
import { registerStuckSkill } from './stuck.js'
import { registerUpdateConfigSkill } from './updateConfig.js'
import { registerVerifySkill } from './verify.js'

/**
 * Initialize all bundled skills.
 * Called at startup to register skills that ship with the CLI.
 *
 * To add a new bundled skill:
 * 1. Create a new file in src/skills/bundled/ (e.g., myskill.ts)
 * 2. Export a register function that calls registerBundledSkill()
 * 3. Import and call that function here
 */
export function initBundledSkills(): void {
  registerUpdateConfigSkill()
  registerKeybindingsSkill()
  registerVerifySkill()
  registerDebugSkill()
  registerLoremIpsumSkill()
  registerSkillifySkill()
  registerRememberSkill()
  registerSimplifySkill()
  registerSddSkill()
  registerBatchSkill()
  registerBrainstormSkill()
  registerWritingPlansSkill()
  registerDatavizSkill()
  registerStuckSkill()
  registerSystematicDebuggingSkill()
  registerTddSkill()
  registerFinishingBranchSkill()
  registerCodeReviewSkill()
  registerSantaLoopSkill()
  registerVerifyCompleteSkill()
  registerMemorySaveSkill()
  // dream.js (KAIROS/KAIROS_DREAM) + hunter.js (REVIEW_ARTIFACT) removed: both
  // require() targets were never committed — aspirational modules that don't
  // exist. Dead in shipped builds (flags off → DCE) but unresolved when
  // dev-full force-enables the flags. Restore the blocks if/when the modules
  // are actually added.
  if (feature('AGENT_TRIGGERS')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerLoopSkill } = require('./loop.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    // /loop's isEnabled delegates to isKairosCronEnabled() — same lazy
    // per-invocation pattern as the cron tools. Registered unconditionally;
    // the skill's own isEnabled callback decides visibility.
    registerLoopSkill()
  }
  if (feature('AGENT_TRIGGERS_REMOTE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const {
      registerScheduleRemoteAgentsSkill,
    } = require('./scheduleRemoteAgents.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerScheduleRemoteAgentsSkill()
  }
  if (feature('BUILDING_CLAUDE_APPS')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerClaudeApiSkill } = require('./claudeApi.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerClaudeApiSkill()
  }
  if (shouldAutoEnableClaudeInChrome()) {
    registerClaudeInChromeSkill()
  }
  if (feature('RUN_SKILL_GENERATOR')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerRunSkillGeneratorSkill } = require('./runSkillGenerator.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerRunSkillGeneratorSkill()
  }
}
