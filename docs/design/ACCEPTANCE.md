# Stitch Design Acceptance Manifest

## Authority and use

Behavioral precedence is: **architecture → this acceptance manifest → `DESIGN.md` → Stitch screenshots → generated HTML**. Screens and HTML are visual evidence, not product requirements. Generated HTML is reference only and must never be copied into production.

Approved reusable visual patterns are the desktop sidebar, Android bottom navigation, dark technical shell, guided chat, draft cards, scene storyboard, preview player, settings cards, credit ledger, credential summary, and pending-operation dialogs.

Reject as product truth: Fotium Motion, Fotium Studio, or Reel Studio customer names; light mobile screens; OpenAI, Stability AI, ElevenLabs, generated music, Cloud Export, subscriptions or Pro Studio; fixed prices, quotas, wait times, storage, or credit packs; 4K/60 FPS promises; multitrack editing; immediate deletion; password-only reauthentication; credit forfeiture; and client-only FAL-key storage. The customer name is F-Motion and the domain is f-motion.com.

`ACCEPT VISUAL` accepts composition and styling only. `ACCEPT WITH CORRECTIONS` requires architecture-aligned copy, state, capability, pricing, provider, security, or naming changes. `REJECT` must not guide implementation. `MISSING` records a required design that Stitch did not produce and therefore has no screen directory below.

## Batch 01 — onboarding

| Screen directory | Decision |
|---|---|
| `batch-01/stitch_fotium_motion_onboarding/welcome_desktop` | ACCEPT VISUAL |
| `batch-01/stitch_fotium_motion_onboarding/welcome_mobile` | ACCEPT VISUAL |
| `batch-01/stitch_fotium_motion_onboarding/auth_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-01/stitch_fotium_motion_onboarding/auth_mobile` | ACCEPT WITH CORRECTIONS |
| `batch-01/stitch_fotium_motion_onboarding/verify_email_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-01/stitch_fotium_motion_onboarding/verify_email_mobile` | ACCEPT WITH CORRECTIONS |
| `batch-01/stitch_fotium_motion_onboarding/format_selection_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-01/stitch_fotium_motion_onboarding/format_selection_mobile` | ACCEPT WITH CORRECTIONS |
| `batch-01/stitch_fotium_motion_onboarding/creative_services_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-01/stitch_fotium_motion_onboarding/creative_services_mobile` | REJECT |
| `batch-01/stitch_fotium_motion_onboarding/ai_setup_desktop` | REJECT |
| `batch-01/stitch_fotium_motion_onboarding/ai_setup_mobile` | REJECT |
| `batch-01/stitch_fotium_motion_onboarding/ready_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-01/stitch_fotium_motion_onboarding/ready_mobile` | REJECT |

## Batch 02 — home and drafts

| Screen directory | Decision |
|---|---|
| `batch-02/stitch_fotium_motion_onboarding/home_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-02/stitch_fotium_motion_onboarding/home_mobile` | ACCEPT WITH CORRECTIONS |
| `batch-02/stitch_fotium_motion_onboarding/new_user_home_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-02/stitch_fotium_motion_onboarding/new_user_home_mobile` | ACCEPT WITH CORRECTIONS |
| `batch-02/stitch_fotium_motion_onboarding/motion_drafts_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-02/stitch_fotium_motion_onboarding/motion_drafts_mobile` | ACCEPT WITH CORRECTIONS |
| `batch-02/stitch_fotium_motion_onboarding/draft_quick_actions_desktop` | ACCEPT VISUAL |
| `batch-02/stitch_fotium_motion_onboarding/draft_quick_actions_mobile` | ACCEPT VISUAL |
| `batch-02/stitch_fotium_motion_onboarding/duplicate_dialog_desktop` | ACCEPT VISUAL |
| `batch-02/stitch_fotium_motion_onboarding/empty_drafts_desktop` | ACCEPT VISUAL |
| `batch-02/stitch_fotium_motion_onboarding/no_search_results_desktop` | ACCEPT VISUAL |
| `batch-02/stitch_fotium_motion_onboarding/rename_dialog_desktop` | ACCEPT VISUAL |
| `batch-02/stitch_fotium_motion_onboarding/status_banners_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-02/stitch_fotium_motion_onboarding/trash_desktop` | ACCEPT VISUAL |

## Batch 03 — guided creation

| Screen directory | Decision |
|---|---|
| `batch-03/stitch_fotium_motion_onboarding/new_create_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-03/stitch_fotium_motion_onboarding/new_create_mobile` | ACCEPT WITH CORRECTIONS |
| `batch-03/stitch_fotium_motion_onboarding/guided_brief_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-03/stitch_fotium_motion_onboarding/media_upload_desktop` | ACCEPT VISUAL |
| `batch-03/stitch_fotium_motion_onboarding/media_upload_mobile` | ACCEPT VISUAL |
| `batch-03/stitch_fotium_motion_onboarding/brief_review_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-03/stitch_fotium_motion_onboarding/creating_concepts_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-03/stitch_fotium_motion_onboarding/concept_options_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-03/stitch_fotium_motion_onboarding/concept_options_mobile` | ACCEPT WITH CORRECTIONS |
| `batch-03/stitch_fotium_motion_onboarding/concept_confirmation_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-03/stitch_fotium_motion_onboarding/insufficient_credits_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-03/stitch_fotium_motion_onboarding/generation_admitted_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-03/stitch_fotium_motion_onboarding/generation_admitted_mobile` | ACCEPT WITH CORRECTIONS |

## Batch 04 — preview, edit, export

| Screen directory | Decision |
|---|---|
| `batch-04/stitch_fotium_motion_onboarding/preview_progress_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-04/stitch_fotium_motion_onboarding/preview_ready_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-04/stitch_fotium_motion_onboarding/preview_ready_mobile` | ACCEPT WITH CORRECTIONS |
| `batch-04/stitch_fotium_motion_onboarding/storyboard_editor_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-04/stitch_fotium_motion_onboarding/storyboard_editor_mobile` | ACCEPT WITH CORRECTIONS |
| `batch-04/stitch_fotium_motion_onboarding/editor_crop_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-04/stitch_fotium_motion_onboarding/export_setup_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-04/stitch_fotium_motion_onboarding/export_complete_desktop` | ACCEPT WITH CORRECTIONS |

## Batch 05 — settings

| Screen directory | Decision |
|---|---|
| `batch-05/stitch_fotium_motion_onboarding/settings_overview_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-05/stitch_fotium_motion_onboarding/settings_mobile` | ACCEPT WITH CORRECTIONS |
| `batch-05/stitch_fotium_motion_onboarding/services_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-05/stitch_fotium_motion_onboarding/connect_fal_key_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-05/stitch_fotium_motion_onboarding/credits_billing_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-05/stitch_fotium_motion_onboarding/add_credits_mobile` | REJECT |
| `batch-05/stitch_fotium_motion_onboarding/storage_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-05/stitch_fotium_motion_onboarding/account_security_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-05/stitch_fotium_motion_onboarding/account_deletion_desktop` | REJECT |

## Batch 06 — account safety and billing details

| Screen directory | Decision |
|---|---|
| `batch-06/stitch_fotium_motion_onboarding/saved_fal_key_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-06/stitch_fotium_motion_onboarding/saved_fal_key_mobile` | ACCEPT WITH CORRECTIONS |
| `batch-06/stitch_fotium_motion_onboarding/credit_ledger_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-06/stitch_fotium_motion_onboarding/credit_ledger_mobile` | REJECT |
| `batch-06/stitch_fotium_motion_onboarding/credit_offers_desktop` | REJECT |
| `batch-06/stitch_fotium_motion_onboarding/fulfillment_pending_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-06/stitch_fotium_motion_onboarding/accessibility_settings_desktop` | ACCEPT VISUAL |
| `batch-06/stitch_fotium_motion_onboarding/deletion_consequences_desktop` | ACCEPT WITH CORRECTIONS |
| `batch-06/stitch_fotium_motion_onboarding/deletion_consequences_mobile` | REJECT |
| `batch-06/stitch_fotium_motion_onboarding/deletion_pending_desktop` | ACCEPT WITH CORRECTIONS |

## Required designs not produced

- MISSING — Pexels preferences and media-source selection
- MISSING — FAL provider unavailable
- MISSING — stale-save conflict and save-as-copy recovery
- MISSING — preview/render failure with retry
- MISSING — Android export, settlement, and failure states
- MISSING — purchase history and receipt detail
- MISSING — change email and active sessions
- MISSING — data export request/status/download expiry
- MISSING — project deletion and Trash recovery on Android
- MISSING — recent reauthentication without assuming a password
- MISSING — account recovery during the deletion window
- MISSING — legal, attribution, privacy, and support details
