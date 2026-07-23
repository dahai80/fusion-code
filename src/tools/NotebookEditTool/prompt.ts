export const DESCRIPTION = `Replaces, inserts, or deletes a single cell in a Jupyter notebook (.ipynb file).`

export const PROMPT = `Replaces, inserts, or deletes a single cell in a Jupyter notebook (.ipynb file).

Key behaviors:
- You must Read the notebook before editing
- cell_id is required for replace and delete operations
- edit_mode defaults to 'replace'; use 'insert' to add new cells, 'delete' to remove
- When inserting, cell_type is required ('code' or 'markdown')
- New cells are inserted after the cell with the given cell_id
- The notebook_path parameter must be an absolute path, not a relative path

When to use:
- Modifying notebook cell contents
- Adding new code or markdown cells
- Removing cells from notebooks
- Restructuring notebook flow

Common patterns:
- Replace cell content: { notebook_path, cell_id, new_source, edit_mode: "replace" }
- Insert after cell: { notebook_path, cell_id, new_source, cell_type: "code", edit_mode: "insert" }
- Delete cell: { notebook_path, cell_id, new_source: "", edit_mode: "delete" }
- Insert at beginning: omit cell_id

Tips:
- Always Read the notebook first to get cell IDs
- Keep cell content focused — one concept per cell
- Use markdown cells for explanations, code cells for executable code
- The new_source must be non-empty for replace and insert modes`
