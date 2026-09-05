import { onRequestGet, onRequestPost, onRequestDelete, onRequestPatch } from './functions/api/locations.js';
import {
  onRequestGet as onRequestGetLeads,
  onRequestPost as onRequestPostLeads,
  onRequestPatch as onRequestPatchLeads,
  onRequestDelete as onRequestDeleteLeads,
} from './functions/api/leads.js';
import {
  onRequestGet as onRequestGetDensity,
  onRequestPost as onRequestPostDensity,
  onRequestDelete as onRequestDeleteDensity,
} from './functions/api/density.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/locations') {
      const c = { request, env, ctx };
      if (request.method === 'GET') return onRequestGet(c);
      if (request.method === 'POST') return onRequestPost(c);
      if (request.method === 'PATCH') return onRequestPatch(c);
      if (request.method === 'DELETE') return onRequestDelete(c);
      return new Response('Method not allowed', { status: 405 });
    }

    if (url.pathname === '/api/leads') {
      const c = { request, env, ctx };
      if (request.method === 'GET') return onRequestGetLeads(c);
      if (request.method === 'POST') return onRequestPostLeads(c);
      if (request.method === 'PATCH') return onRequestPatchLeads(c);
      if (request.method === 'DELETE') return onRequestDeleteLeads(c);
      return new Response('Method not allowed', { status: 405 });
    }

    if (url.pathname === '/api/density') {
      const c = { request, env, ctx };
      if (request.method === 'GET') return onRequestGetDensity(c);
      if (request.method === 'POST') return onRequestPostDensity(c);
      if (request.method === 'DELETE') return onRequestDeleteDensity(c);
      return new Response('Method not allowed', { status: 405 });
    }

    return env.ASSETS.fetch(request);
  }
};
