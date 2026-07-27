// log: stub for TS2307 — FeedbackSurvey utils

export type FeedbackSurveyResponse = {
    skillName: string
    action: 'keep' | 'update' | 'remove'
    feedback?: string
}
