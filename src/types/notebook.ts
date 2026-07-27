// log: stub for TS2307 — notebook type definitions

export type NotebookCellType = 'code' | 'markdown'

export type NotebookOutputImage = {
    image_data: string
    media_type: 'image/png' | 'image/jpeg'
}

export type NotebookCellOutput = {
    output_type: 'stream' | 'execute_result' | 'display_data' | 'error'
    text?: string | string[]
    data?: Record<string, string | string[]>
    ename?: string
    evalue?: string
    traceback?: string[]
}

export type NotebookCellSourceOutput = {
    output_type: string
    text?: string
    image?: NotebookOutputImage
}

export type NotebookCellSource = {
    cellType: NotebookCellType
    source: string
    execution_count?: number
    cell_id: string
    language?: string
    outputs?: NotebookCellSourceOutput[]
}

export type NotebookCell = {
    cell_type: NotebookCellType
    source: string | string[]
    id?: string
    execution_count?: number
    outputs?: NotebookCellOutput[]
}

export type NotebookKernelSpec = {
    name?: string
    display_name?: string
    language?: string
}

export type NotebookLanguageInfo = {
    name?: string
    version?: string
    codemirror_mode?: string | Record<string, unknown>
    file_extension?: string
    mimetype?: string
    pygments_lexer?: string
}

export type NotebookMetadata = {
    kernelspec?: NotebookKernelSpec
    language_info?: NotebookLanguageInfo
    [key: string]: unknown
}

export type NotebookContent = {
    nbformat: number
    nbformat_minor: number
    metadata?: NotebookMetadata
    cells: NotebookCell[]
}
