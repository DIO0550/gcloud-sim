export const AgentRead = ["aiplatform.reasoningEngines.get", "aiplatform.reasoningEngines.list"];
export const AgentWrite = [
  ...AgentRead,
  "aiplatform.reasoningEngines.create",
  "aiplatform.reasoningEngines.update",
  "aiplatform.reasoningEngines.delete",
];
export const NotebookRead = ["notebooks.instances.get", "notebooks.instances.list"];
export const NotebookWrite = [
  ...NotebookRead,
  "notebooks.instances.create",
  "notebooks.instances.update",
  "notebooks.instances.delete",
  "notebooks.instances.start",
  "notebooks.instances.stop",
];
export const WorkstationRead = ["workstations.workstations.get", "workstations.workstations.list"];
export const WorkstationWrite = [
  ...WorkstationRead,
  "workstations.workstations.create",
  "workstations.workstations.update",
  "workstations.workstations.delete",
  "workstations.workstations.start",
  "workstations.workstations.stop",
];
export const AiRead = [...AgentRead, ...NotebookRead, ...WorkstationRead];
export const AiWrite = [...AgentWrite, ...NotebookWrite, ...WorkstationWrite];
