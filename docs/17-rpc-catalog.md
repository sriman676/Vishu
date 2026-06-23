# 17 — JSON-RPC Method Catalog

Every JSON-RPC method exposed by the core, **renamed to the `vishu.*` namespace** (the live
source uses `aetheria.*`; renaming the prefix is a mechanical find/replace at registration).
Method naming convention: `vishu.<namespace>_<function>`.

> Extracted from the actual method-name string registrations in `src/` (114 names total).
> Exact params/returns for a method live in that domain's `schemas.rs` `handle_*` fn —
> open it to confirm the precise shape. Core domains are detailed below; the long tail is
> cataloged by name + purpose.

## ⚠️ Test/placeholder methods — NOT product methods (do not implement)

These are test fixtures found in the registry and must be ignored for a rebuild:
`vishu.alpha`, `vishu.beta`, `vishu.ping`, `vishu.browser`, `vishu.service`,
`vishu.legacy_alpha`, `vishu.legacy_literal`, `vishu.literal_target`,
`vishu.nonexistent_method_xyz`, `vishu.not_a_real_method_xyz_123`, `vishu.totally_made_up_xyz`.

---

## Core domains (implement in full)

### auth / security
| Method | Purpose |
| --- | --- |
| `vishu.auth_store_session` | Persist a signed-in session (user_id, tokens) into the credential store |
| `vishu.encrypt_secret` | Encrypt a plaintext secret (AES-256-GCM); requires `plaintext` param |
| `vishu.security_policy_info` | Return the active SecurityPolicy tier + modifiers |

### config (+ legacy non-namespaced aliases)
| Method | Purpose |
| --- | --- |
| `vishu.config_get` (alias `vishu.get_config`) | Full config snapshot |
| `vishu.config_update_autonomy_settings` (alias `vishu.update_autonomy_settings`) | Set autonomy tier / trusted_roots / allow_tool_install |
| `vishu.config_update_memory_settings` (alias `vishu.update_memory_settings`) | Memory config |
| `vishu.config_update_runtime_settings` (alias `vishu.update_runtime_settings`) | Runtime flags |
| `vishu.config_update_browser_settings` (alias `vishu.update_browser_settings`) | Browser/web tool config |
| `vishu.config_set_browser_allow_all` (alias `vishu.set_browser_allow_all`) | Toggle browse allow-all |
| `vishu.config_update_analytics_settings` (alias `vishu.update_analytics_settings`) | Analytics opt-in |
| `vishu.config_update_composio_trigger_settings` (alias `vishu.update_composio_trigger_settings`) | Composio trigger config |
| `vishu.config_update_screen_intelligence_settings` (alias `vishu.update_screen_intelligence_settings`) | Screen-intelligence config |
| `vishu.config_get_analytics_settings` / `_composio_trigger_settings` / `_dashboard_settings` / `_runtime_flags` | Per-section getters (+ legacy aliases without `config_`) |
| `vishu.config_workspace_onboarding_flag_exists` / `_set` (aliases `vishu.workspace_onboarding_flag_exists` / `_set`) | Onboarding flag |

### agent / memory
| Method | Purpose |
| --- | --- |
| `vishu.memory_init` | Initialize the memory store for the workspace |
| `vishu.memory_doc_put` | Insert/update a memory document |
| `vishu.memory_recall_memories` | Recall memories (hybrid search) for a query |
| `vishu.memory_list_namespaces` | List memory namespaces |
| `vishu.memory_query_namespace` | Query within a namespace |
| `vishu.memory_tree_recall` | Recall from the memory tree |
| `vishu.memory_tree_search` | Search the memory tree |
| `vishu.memory_tree_list_sources` | List ingested tree sources |
| `vishu.memory_tree_list_chunks` / `vishu.memory_tree_get_chunk` | List/get chunks |
| `vishu.memory_tree_top_entities` | Top entities by hotness |
| `vishu.embeddings_embed` / `vishu.inference_embed` | Compute embeddings for text |

### inference / providers / local AI
| Method | Purpose |
| --- | --- |
| `vishu.inference_prompt` | Run a prompt against the active provider |
| `vishu.inference_list_models` (alias `vishu.providers_list_models`) | List available models |
| `vishu.inference_presets` (alias `vishu.local_ai_presets`) | List inference presets |
| `vishu.inference_apply_preset` (alias `vishu.local_ai_apply_preset`) | Apply a preset |
| `vishu.inference_device_profile` (alias `vishu.local_ai_device_profile`) | Hardware capability profile |
| `vishu.inference_diagnostics` (alias `vishu.local_ai_diagnostics`) | Diagnostics for local AI |
| `vishu.inference_update_local_settings` (alias `vishu.update_local_ai_settings`) | Update local-AI settings |
| `vishu.inference_update_model_settings` (alias `vishu.update_model_settings`) | Update model settings |
| `vishu.doctor_models` | Validate model configuration |

### channels / integrations / mcp
| Method | Purpose |
| --- | --- |
| `vishu.composio_list_connections` | List Composio connections |
| `vishu.mcp_list` / `vishu.mcp_servers_list` | List MCP servers |
| `vishu.mcp_clients_list` / `vishu.mcp_clients_installed_list` | List MCP clients |
| `vishu.mcp_clients_tool_call` | Invoke a tool on an MCP client |
| `vishu.mcp_audit_list` | MCP audit log |
| `vishu.tool_registry_call` | Invoke a tool from the unified registry |
| `vishu.tools_web_search` / `vishu.tools_searxng_search` | Web search tools |

### billing
`vishu.billing_get_balance`, `vishu.billing_get_current_plan`, `vishu.billing_purchase_plan`,
`vishu.billing_top_up`, `vishu.billing_create_portal_session`,
`vishu.billing_create_coinbase_charge`.

### team
`vishu.team_list_members`, `vishu.team_change_member_role`, `vishu.team_remove_member`,
`vishu.team_create_invite`, `vishu.team_list_invites`, `vishu.team_revoke_invite`.

---

## Long tail (catalog — implement per domain)

| Method | Domain | Purpose |
| --- | --- | --- |
| `vishu.health_snapshot`, `vishu.health_system_info`, `vishu.system_info` | health | Liveness + host info |
| `vishu.autocomplete_status` | autocomplete | Autocomplete availability |
| `vishu.council_registry_list` / `_upsert` | council_registry | Manage model councils |
| `vishu.model_council_run` / `_answer_member` / `_synthesize` | model_council | Run multi-model deliberation |
| `vishu.threads_generate_title`, `vishu.threads_message_append` | threads | Thread title + append |
| `vishu.workspace_file_read` / `_write` / `_reset` | workspace | Workspace file ops (gated) |
| `vishu.update_apply`, `vishu.update_run` | update | App self-update |
| `vishu.migrate_hermes`, `vishu.migrate_openclaw` | migration | Import from legacy products |
| `vishu.service_status` | service | Background service status |

## Conventions to preserve
- All methods return the `RpcOutcome<T>` envelope (ok/result or typed error).
- Param validation happens in `schemas.rs handle_*` before delegating to `ops.rs`.
- Keep legacy aliases only if you need backward compatibility; otherwise drop the
  non-namespaced duplicates (`get_config`, `update_*`) and keep the `config_*` form.
