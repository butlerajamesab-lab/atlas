import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

function get_db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function shell(title, body) {
  const css = `*{box-sizing:border-box;margin:0;padding:0}body{background:#0a0a0a;color:#e8e8e8;font-family:system-ui,sans-serif;padding:2rem;max-width:900px;margin:0 auto}a{color:#7eb3e8;text-decoration:none}.declaration{font-size:2rem;font-weight:700;color:#fff;margin:2rem 0 .5rem}.self_name{font-size:1.4rem;color:#a8c8f0;margin-bottom:.25rem}.meaning{color:#888;margin-bottom:2rem}.layer{background:#111;border:1px solid #222;border-radius:8px;padding:1.5rem;margin-bottom:1rem}.lbl{font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;color:#555;margin-bottom:.75rem}.locked{opacity:.5}.card{display:block;background:#111;border:1px solid #222;border-radius:8px;padding:1.5rem;margin-bottom:1rem}.hdr{margin-bottom:3rem;padding-bottom:2rem;border-bottom:1px solid #1a1a1a}.sub{color:#555;margin-top:.75rem;line-height:1.7}pre{white-space:pre-wrap;word-break:break-word;font-size:.85rem;color:#aaa}.back{color:#555;font-size:.9rem;margin-bottom:2rem;display:block}.commit{background:#0d1a0d;border:1px solid #1a3a1a;border-radius:8px;padding:1rem 1.5rem;margin-top:3rem;color:#4a7a4a;font-size:.85rem;line-height:1.6}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style></head><body>${body}</body></html>`;
}

router.get('/recognition-atlas', async (_req, res) => {
  const db = get_db();
  const { data: tribes, error } = await db.from('tribe_registry').select('tribe_id,anglicized_name,self_name,self_name_meaning,federal_status');
  if (error) return res.status(500).send(shell('Error', `<p style="color:#e87e7e">${error.message}</p>`));
  const cards = (tribes || []).map(t => `<a href="/recognition-atlas/${t.tribe_id}" class="card"><div class="self_name">${t.self_name}</div><div style="color:#ccc">${t.anglicized_name}</div><div class="meaning">${t.self_name_meaning || ''}</div><div style="color:#e87e7e;font-size:.8rem;text-transform:uppercase">${t.federal_status}</div></a>`).join('');
  res.send(shell('Recognition Atlas', `<div class="hdr"><h1 style="font-size:1.8rem;color:#fff">Recognition Atlas</h1><p class="sub">Built in partnership with tribal communities.<br>Nothing goes public without explicit tribal approval.<br><em style="color:#444">We are the vessel. They are the author.</em></p></div>${cards || '<p style="color:#444">No tribes in registry yet.</p>'}`));
});

router.get('/recognition-atlas/:tribe_id', async (req, res) => {
  const db = get_db();
  const { tribe_id } = req.params;
  const [{ data: tribe }, { data: layers }, { data: language }] = await Promise.all([
    db.from('tribe_registry').select('*').eq('tribe_id', tribe_id).single(),
    db.from('tribe_truth_layers').select('*').eq('tribe_id', tribe_id).order('layer_key'),
    db.from('language_entries').select('*').eq('tribe_id', tribe_id).order('entry_id'),
  ]);
  if (!tribe) return res.status(404).send(shell('Not Found', '<p style="color:#555">Tribe not found.</p>'));
  const identity = (layers || []).find(l => l.layer_key === 'layer_0_identity');
  const rest = (layers || []).filter(l => l.layer_key !== 'layer_0_identity');
  const id_html = identity ? `<div class="declaration">${identity.content.primary_declaration}</div><div class="self_name">${identity.content.tribe_self_name}</div><div class="meaning">${identity.content.name_meaning}</div>` : '';
  const layers_html = rest.map(l => l.locked ? `<div class="layer locked"><div class="lbl">${l.layer_label}</div><p style="color:#444;font-size:.9rem">Pending review by the ${tribe.anglicized_name}. Nothing displays without explicit tribal approval.</p></div>` : `<div class="layer"><div class="lbl">${l.layer_label}</div><pre>${JSON.stringify(l.content, null, 2)}</pre></div>`).join('');
  const lang_html = (language || []).length ? `<div class="layer" style="margin-top:2rem"><div class="lbl">Language Vault — Permanent Record</div>${(language || []).map(e => `<div style="margin-bottom:1.25rem"><div style="font-size:1.1rem;color:#a8c8f0;font-weight:600">${e.original_text}</div><div style="color:#888;font-size:.85rem">${e.romanization || ''}</div><div style="color:#ccc;margin-top:.25rem">${e.english_gloss}</div>${e.extended_meaning ? `<div style="color:#666;font-size:.85rem;margin-top:.25rem">${e.extended_meaning}</div>` : ''}</div>`).join('')}<p style="color:#333;font-size:.75rem;margin-top:1rem">deletion_policy: never | immutable: true | government_override_permitted: false</p></div>` : '';
  res.send(shell(`${tribe.self_name} — Recognition Atlas`, `<a href="/recognition-atlas" class="back">← All Tribes</a>${id_html}${layers_html}${lang_html}<div class="commit">luminari_commitment: "we_are_the_vessel_they_are_the_author"<br>right_to_erasure: "tribe_only_not_government"<br>data_portability: "full"</div>`));
});

export { router as recognitionAtlasRouter };
