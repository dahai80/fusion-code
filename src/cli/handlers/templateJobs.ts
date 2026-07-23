/**
 * Template Jobs — 模板任务处理器
 *
 * 处理模板任务的生命周期：创建、列出、回复。
 * 模板任务是一种可复用的对话模板，允许用户基于预设模板
 * 快速启动新的对话会话。
 *
 * gated by feature('TEMPLATES')
 */

import { feature } from 'bun:bundle'
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

export interface TemplateJob {
  id: string
  name: string
  description: string
  template: string
  createdAt: number
  status: 'pending' | 'active' | 'completed' | 'failed'
}

function getJobsDir(): string {
  return join(getClaudeConfigHomeDir(), 'jobs')
}

function ensureJobsDir(): void {
  const dir = getJobsDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Main entry point for template job commands.
 * Called from the CLI fast-path in cli.tsx.
 */
export async function templatesMain(args: string[]): Promise<void> {
  if (!feature('TEMPLATES')) {
    console.error('Templates are not enabled in this build.')
    return
  }

  const subcommand = args[0]?.toLowerCase()

  switch (subcommand) {
    case 'new':
      await handleNew(args.slice(1))
      break
    case 'list':
      handleList()
      break
    case 'reply':
      await handleReply(args.slice(1))
      break
    default:
      console.log('Usage: claude new <template-name> [--description "..." ]')
      console.log('       claude list')
      console.log('       claude reply <job-id> <response>')
  }
}

async function handleNew(args: string[]): Promise<void> {
  const templateName = args[0]
  if (!templateName) {
    console.error('Error: Template name is required.')
    return
  }

  ensureJobsDir()
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const job: TemplateJob = {
    id: jobId,
    name: templateName,
    description: args[1] || '',
    template: '',
    createdAt: Date.now(),
    status: 'pending',
  }

  writeFileSync(
    join(getJobsDir(), `${jobId}.json`),
    JSON.stringify(job, null, 2),
  )

  console.log(`Created job ${jobId} for template "${templateName}"`)
}

function handleList(): void {
  ensureJobsDir()
  const files = readdirSync(getJobsDir()).filter(f => f.endsWith('.json'))

  if (files.length === 0) {
    console.log('No template jobs found.')
    return
  }

  console.log('Template jobs:')
  for (const file of files) {
    try {
      const content = readFileSync(join(getJobsDir(), file), 'utf-8')
      const job = JSON.parse(content) as TemplateJob
      console.log(`  ${job.id}: ${job.name} (${job.status})`)
    } catch {
      // Skip malformed files
    }
  }
}

async function handleReply(args: string[]): Promise<void> {
  const jobId = args[0]
  const response = args.slice(1).join(' ')

  if (!jobId || !response) {
    console.error('Error: Job ID and response are required.')
    return
  }

  // 防止路径遍历攻击：只允许字母、数字、连字符和下划线
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    console.error(`Error: Invalid job ID format: ${jobId}`)
    return
  }

  const jobPath = join(getJobsDir(), `${jobId}.json`)
  if (!existsSync(jobPath)) {
    console.error(`Error: Job ${jobId} not found.`)
    return
  }

  try {
    const content = readFileSync(jobPath, 'utf-8')
    const job = JSON.parse(content) as TemplateJob
    job.status = 'completed'
    writeFileSync(jobPath, JSON.stringify(job, null, 2))
    console.log(`Job ${jobId} completed with response: ${response}`)
  } catch (error) {
    console.error(`Error: Failed to update job ${jobId}: ${(error as Error).message}`)
  }
}