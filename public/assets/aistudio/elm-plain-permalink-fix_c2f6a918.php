<?php
/**
 * Plugin Name: Epic License Manager - Plain Permalink & JSON Guard Patch
 * Description: Enables /wp-json/elm/v1/* routing fallback on Plain Permalinks, strips stray output before JSON, ensures public REST access for /elm/v1/* endpoints, and checks PHP libsodium in WordPress Admin.
 * Version: 1.0.0
 * Author: Epic Music Player Integration
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * 1. Route /wp-json/elm/v1/... requests even when WordPress Permalinks are set to Plain (/?p=123),
 *    provided the web server passes the URI to WordPress index.php.
 */
add_action( 'parse_request', function ( $wp ) {
    if ( empty( $_SERVER['REQUEST_URI'] ) ) {
        return;
    }
    $path = parse_url( wp_unslash( $_SERVER['REQUEST_URI'] ), PHP_URL_PATH );
    if ( ! is_string( $path ) ) {
        return;
    }

    $pos = strpos( $path, '/wp-json/elm/v1' );
    if ( $pos !== false ) {
        $rest_route = substr( $path, $pos + strlen( '/wp-json' ) );
        $wp->query_vars['rest_route'] = '/' . ltrim( $rest_route, '/' );
    }
}, 1 );

/**
 * 2. Allow Epic License Manager public endpoints (/elm/v1/trial/activate, /license/activate,
 *    /license/verify, /promo) even if a site security plugin restricts WordPress REST API to logged-in users.
 */
add_filter( 'rest_authentication_errors', function ( $result ) {
    if ( ! is_wp_error( $result ) ) {
        return $result;
    }

    $route = '';
    if ( isset( $_GET['rest_route'] ) ) {
        $route = (string) wp_unslash( $_GET['rest_route'] );
    } elseif ( ! empty( $GLOBALS['wp']->query_vars['rest_route'] ) ) {
        $route = (string) $GLOBALS['wp']->query_vars['rest_route'];
    } elseif ( ! empty( $_SERVER['REQUEST_URI'] ) ) {
        $route = (string) wp_unslash( $_SERVER['REQUEST_URI'] );
    }

    if ( strpos( $route, '/elm/v1/' ) !== false ) {
        $code = $result->get_error_code();
        if ( in_array( $code, array( 'rest_cannot_access', 'rest_login_required', 'rest_not_logged_in' ), true ) ) {
            return null;
        }
    }

    return $result;
}, 999 );

/**
 * 3. Clean stray PHP notices/whitespace before serving /elm/v1/* JSON responses so Android
 *    never receives HTML prefixes before '{'.
 */
add_filter( 'rest_pre_serve_request', function ( $served, $result, $request, $server ) {
    $route = method_exists( $request, 'get_route' ) ? $request->get_route() : '';
    if ( strpos( (string) $route, '/elm/v1/' ) === 0 ) {
        while ( ob_get_level() > 0 ) {
            $buf = ob_get_contents();
            if ( $buf !== false && trim( $buf ) !== '' && substr( ltrim( $buf ), 0, 1 ) !== '{' ) {
                ob_clean();
            }
            break;
        }
        if ( ! headers_sent() ) {
            header( 'Content-Type: application/json; charset=utf-8' );
            header( 'X-ELM-Router: active' );
        }
    }
    return $served;
}, 1, 4 );

/**
 * 4. Admin diagnostic banner: verifies PHP Sodium and shows the exact test URL for Plain Permalinks.
 */
add_action( 'admin_notices', function () {
    if ( ! current_user_can( 'manage_options' ) ) {
        return;
    }

    $screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
    $is_elm_or_plugins = $screen && (
        strpos( (string) $screen->id, 'epic' ) !== false ||
        strpos( (string) $screen->id, 'elm' ) !== false ||
        $screen->id === 'plugins' ||
        $screen->id === 'options-permalink'
    );
    if ( ! $is_elm_or_plugins ) {
        return;
    }

    $has_sodium = function_exists( 'sodium_crypto_sign_detached' );
    $plain_permalinks = empty( get_option( 'permalink_structure' ) );
    $test_url = home_url( '/?rest_route=/elm/v1/promo&app_slug=epic-music-player' );

    echo '<div class="notice notice-info is-dismissible"><p>';
    echo '<strong>Epic License Manager Patch:</strong> ';
    echo $has_sodium
        ? 'PHP Sodium (Ed25519) فعال است. '
        : '<span style="color:#d63638;font-weight:bold;">هشدار: اکستنشن PHP sodium روی هاست غیرفعال است!</span> ';
    if ( $plain_permalinks ) {
        echo 'پیوندهای یکتا روی حالت <strong>ساده (Plain)</strong> است؛ آدرس تست API: ';
    } else {
        echo 'آدرس تست جایگزین API: ';
    }
    echo '<a href="' . esc_url( $test_url ) . '" target="_blank" rel="noopener noreferrer">' . esc_html( $test_url ) . '</a>';
    echo '</p></div>';
} );
