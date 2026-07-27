// log: created for TS2307 fix

export type FileSuggestionCommandInput = {
    session_id: string
    transcript_path: string
    cwd: string
    permission_mode?: string
    agent_id?: string
    agent_type?: string
    query: string
}
