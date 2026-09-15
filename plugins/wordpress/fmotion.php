<?php
/**
 * Plugin Name: F-Motion
 * Description: Stub. Thin adapter over F-Motion import and render.complete. Not installable yet.
 * Version: 0.0.0-stub
 *
 * Follow-up: HTTP client, settings UI, media library attach.
 * Do not put social API tokens or Immich/faces here.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Filter the import payload before POST /v1/integrations/project-imports.
 *
 * @param array $payload {
 *     @type string   $external_id
 *     @type string[] $media_urls
 *     @type string   $title
 *     @type string   $caption
 *     @type string   $call_to_action
 *     @type array    $architecture
 * }
 * @return array
 */
function fmotion_before_import( array $payload ): array {
	return apply_filters( 'fmotion_before_import', $payload );
}

/**
 * @param array $result { @type string $external_id, @type string $project_id, @type string $projectUrl, @type bool $created }
 */
function fmotion_after_import( array $result ): void {
	do_action( 'fmotion_after_import', $result );
}

/**
 * @param string $project_url
 * @param array  $result
 * @return string Link-out URL. Do not iframe the studio.
 */
function fmotion_edit_open( string $project_url, array $result ): string {
	return (string) apply_filters( 'fmotion_edit_open', $project_url, $result );
}

/**
 * Fire after the MP4 is stored in the media library. Sibling plugins subscribe here.
 *
 * @param array $event {
 *     @type string $external_id
 *     @type string $job_id
 *     @type string $project_id
 *     @type string $kind
 *     @type string $mp4_url
 *     @type int    $post_id
 *     @type int    $attachment_id
 * }
 */
function fmotion_reel_ready( array $event ): void {
	do_action( 'fmotion_reel_ready', $event );
}

add_action(
	'rest_api_init',
	static function (): void {
		$stub = static function ( $code, $message ) {
			return static function () use ( $code, $message ) {
				return new WP_Error( $code, $message, array( 'status' => 501 ) );
			};
		};
		register_rest_route(
			'fmotion/v1',
			'/notify',
			array(
				'methods'             => 'POST',
				'permission_callback' => '__return_true',
				'callback'            => $stub(
					'fmotion_stub',
					'Notify REST is documented. The follow-up plugin verifies X-F-Motion-Signature and fires fmotion_reel_ready.'
				),
			)
		);
		register_rest_route(
			'fmotion/v1',
			'/import',
			array(
				'methods'             => 'POST',
				'permission_callback' => '__return_true',
				'callback'            => $stub(
					'fmotion_stub',
					'Import REST is documented. The follow-up plugin applies fmotion_before_import then POSTs project-imports.'
				),
			)
		);
	}
);
