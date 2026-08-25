#!/usr/bin/env node
/**
 * Create or update the dedicated F-Motion LinkedIn n8n workflow.
 * Requires N8N_API_URL and N8N_API_KEY in the environment.
 */
import {readFile} from 'node:fs/promises';

const workflowPath = new URL('../ops/n8n/fmotion-linkedin.workflow.json', import.meta.url);

function apiBase() {
  return (process.env.N8N_API_URL || 'http://localhost:5678/api/v1').replace(/\/+$/, '');
}

function apiKey() {
  const key = process.env.N8N_API_KEY;
  if (!key) throw new Error('N8N_API_KEY is required.');
  return key;
}

async function n8n(path, options = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': apiKey(),
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    throw new Error(`n8n API ${options.method ?? 'GET'} ${path} returned ${response.status}`);
  }
  return body;
}

async function findExistingWorkflow(name) {
  const list = await n8n('/workflows?limit=100');
  const workflows = Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : [];
  return workflows.find((workflow) => workflow.name === name) ?? null;
}

function payloadFrom(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings ?? {},
    staticData: workflow.staticData ?? null,
  };
}

async function main() {
  const workflow = JSON.parse(await readFile(workflowPath, 'utf8'));
  const existing = await findExistingWorkflow(workflow.name);
  const payload = payloadFrom(workflow);

  let id;
  if (existing?.id) {
    const updated = await n8n(`/workflows/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    id = updated.id ?? existing.id;
    console.log(JSON.stringify({updated: true, id, name: workflow.name}, null, 2));
  } else {
    const created = await n8n('/workflows', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    id = created.id;
    console.log(JSON.stringify({created: true, id, name: workflow.name}, null, 2));
  }

  if (id && process.env.FMOTION_LINKEDIN_ACTIVATE === '1') {
    await n8n(`/workflows/${id}/activate`, {method: 'POST'});
    console.log(JSON.stringify({activated: true, id}, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
