// The rotation reference's own pieces: the flowchart and the box it draws nineteen times.
//
// A folder rather than more of `sections/Rotation.tsx`, per the one-component-per-file rule — the
// section holds the argument and the notes, and these two hold the drawing.
//
// Re-exports only — never put logic in here.

export { default as FlowChart } from './FlowChart';
export { default as FlowNode } from './FlowNode';
