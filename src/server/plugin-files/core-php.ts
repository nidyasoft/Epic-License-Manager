export interface PluginBuildOptions {
  storeDomain: string;
  triggerStatuses: string[];
  publicCalendar: string;
  adminCalendar: string;
  pluginCalendar: string;
}

export function buildMainPluginPhp(opts: PluginBuildOptions): string {
  const triggerExport = opts.triggerStatuses.map((s) => `'${s.replace(/[^a-z0-9\-]/gi, '')}'`).join(', ');
  return `<?php
/**
 * Plugin Name:       Epic License Manager
 * Plugin URI:        https://${opts.storeDomain}
 * Description:       Enterprise WooCommerce License & Trial Manager with Ed25519 Offline Tokens, Multi-Calendar (Gregorian/Jalali/Hijri), ACF-Style Conditional Custom Fields, CPT HTML Promos, True XLSX Reporting, Embedded Phone Simulator & Real SDK Code Builder.
 * Version:           2.0.0
 * Requires at least: 6.5
 * Requires PHP:      8.2
 * WC requires at least: 8.0
 * WC tested up to:   9.8
 * Author:            Epic License Systems
 * Text Domain:       epic-license-manager
 * Domain Path:       /languages
 * License:           GPL-2.0-or-later
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'ELM_VERSION', '2.0.0' );
define( 'ELM_PLUGIN_FILE', __FILE__ );
define( 'ELM_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'ELM_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'ELM_MU_PATCH_FILENAME', 'elm-plain-permalink-fix.php' );

// Declare WooCommerce High-Performance Order Storage (HPOS) compatibility cleanly.
add_action( 'before_woocommerce_init', static function (): void {
    if ( class_exists( \\Automattic\\WooCommerce\\Utilities\\FeaturesUtil::class ) ) {
        \\Automattic\\WooCommerce\\Utilities\\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
    }
} );

require_once ELM_PLUGIN_DIR . 'includes/class-elm-calendar.php';
require_once ELM_PLUGIN_DIR . 'includes/class-elm-crypto.php';
require_once ELM_PLUGIN_DIR . 'includes/class-elm-custom-fields.php';
require_once ELM_PLUGIN_DIR . 'includes/class-elm-promo-cpt.php';
require_once ELM_PLUGIN_DIR . 'includes/class-elm-woocommerce.php';
require_once ELM_PLUGIN_DIR . 'includes/class-elm-rest-api.php';
require_once ELM_PLUGIN_DIR . 'includes/class-elm-reports.php';
require_once ELM_PLUGIN_DIR . 'includes/class-elm-admin.php';

final class Epic_License_Manager {

    private static ?self $instance = null;

    public ELM_Calendar $calendar;
    public ELM_Crypto $crypto;
    public ELM_Custom_Fields $custom_fields;
    public ELM_Promo_CPT $promo_cpt;
    public ELM_WooCommerce $woocommerce;
    public ELM_Rest_API $rest_api;
    public ELM_Reports $reports;
    public ELM_Admin $admin;

    public static function instance(): self {
        if ( null === self::$instance ) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        add_action( 'init', [ $this, 'load_textdomain' ] );

        $this->calendar      = new ELM_Calendar();
        $this->crypto        = new ELM_Crypto();
        $this->custom_fields = new ELM_Custom_Fields( $this->calendar );
        $this->promo_cpt     = new ELM_Promo_CPT();
        $this->woocommerce   = new ELM_WooCommerce( $this->crypto );
        $this->rest_api      = new ELM_Rest_API( $this->crypto );
        $this->reports       = new ELM_Reports( $this->calendar, $this->custom_fields );
        $this->admin         = new ELM_Admin( $this->calendar, $this->crypto, $this->reports, $this->custom_fields, $this->promo_cpt );
    }

    public function load_textdomain(): void {
        load_plugin_textdomain(
            'epic-license-manager',
            false,
            dirname( plugin_basename( ELM_PLUGIN_FILE ) ) . '/languages'
        );
    }

    public static function get_mu_patch_code(): string {
        return <<<'PHP'
<?php
/**
 * Plugin Name: Epic License Manager - Plain Permalink & JSON Guard Patch (Auto-Managed)
 * Description: Automatically installed and removed by Epic License Manager. Routes /wp-json/elm/v1/* on Plain Permalinks, prevents stray output before JSON, and exempts /elm/v1/* from guest REST restrictions.
 * Version: 2.0.0
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

add_action( 'parse_request', function ( $wp ) {
    if ( empty( $_SERVER['REQUEST_URI'] ) ) { return; }
    $path = parse_url( wp_unslash( $_SERVER['REQUEST_URI'] ), PHP_URL_PATH );
    if ( ! is_string( $path ) ) { return; }
    $pos = strpos( $path, '/wp-json/elm/v1' );
    if ( $pos !== false ) {
        $rest_route = substr( $path, $pos + strlen( '/wp-json' ) );
        $wp->query_vars['rest_route'] = '/' . ltrim( $rest_route, '/' );
    }
}, 1 );

add_filter( 'rest_authentication_errors', function ( $result ) {
    if ( ! is_wp_error( $result ) ) { return $result; }
    $route = $_GET['rest_route'] ?? ( $GLOBALS['wp']->query_vars['rest_route'] ?? ( $_SERVER['REQUEST_URI'] ?? '' ) );
    if ( is_string( $route ) && strpos( $route, '/elm/v1/' ) !== false ) {
        if ( in_array( $result->get_error_code(), [ 'rest_cannot_access', 'rest_login_required', 'rest_not_logged_in' ], true ) ) {
            return null;
        }
    }
    return $result;
}, 999 );

add_filter( 'rest_pre_serve_request', function ( $served, $result, $request ) {
    $route = method_exists( $request, 'get_route' ) ? (string) $request->get_route() : '';
    if ( strpos( $route, '/elm/v1/' ) === 0 ) {
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
}, 1, 3 );
PHP;
    }

    public static function install_mu_patch(): bool {
        $mu_dir = defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : ( WP_CONTENT_DIR . '/mu-plugins' );
        if ( ! is_dir( $mu_dir ) ) {
            wp_mkdir_p( $mu_dir );
        }
        if ( ! is_dir( $mu_dir ) || ! is_writable( $mu_dir ) ) {
            return false;
        }
        $target = trailingslashit( $mu_dir ) . ELM_MU_PATCH_FILENAME;
        return false !== file_put_contents( $target, self::get_mu_patch_code() );
    }

    public static function remove_mu_patch(): void {
        $mu_dir = defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : ( WP_CONTENT_DIR . '/mu-plugins' );
        $target = trailingslashit( $mu_dir ) . ELM_MU_PATCH_FILENAME;
        if ( file_exists( $target ) && is_writable( $target ) ) {
            @unlink( $target );
        }
    }

    public static function activate(): void {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $charset           = $wpdb->get_charset_collate();
        $apps_table        = $wpdb->prefix . 'elm_apps';
        $licenses_table    = $wpdb->prefix . 'elm_licenses';
        $activations_table = $wpdb->prefix . 'elm_activations';

        $sql_apps = "CREATE TABLE {$apps_table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            app_slug VARCHAR(100) NOT NULL,
            app_name VARCHAR(191) NOT NULL,
            platform VARCHAR(40) NOT NULL DEFAULT 'android',
            license_mode VARCHAR(40) NOT NULL DEFAULT 'method2_trial',
            trial_days INT UNSIGNED NOT NULL DEFAULT 14,
            offline_grace_days INT UNSIGNED NOT NULL DEFAULT 14,
            public_key TEXT NOT NULL,
            public_key_hex VARCHAR(128) NOT NULL DEFAULT '',
            private_key TEXT NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            purchase_url VARCHAR(500) NOT NULL DEFAULT '',
            gated_features LONGTEXT NULL,
            promo_enabled TINYINT(1) NOT NULL DEFAULT 1,
            promo_display_mode VARCHAR(40) NOT NULL DEFAULT 'floating_modal',
            promo_interval_sec INT UNSIGNED NOT NULL DEFAULT 180,
            promo_post_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            promo_html LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY app_slug (app_slug)
        ) {$charset};";

        $sql_licenses = "CREATE TABLE {$licenses_table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            license_key VARCHAR(80) NOT NULL,
            app_id BIGINT UNSIGNED NOT NULL,
            order_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            customer_email VARCHAR(191) NOT NULL DEFAULT '',
            customer_name VARCHAR(191) NOT NULL DEFAULT '',
            customer_mobile VARCHAR(60) NOT NULL DEFAULT '',
            product_title VARCHAR(191) NOT NULL DEFAULT '',
            payment_method VARCHAR(100) NOT NULL DEFAULT '',
            order_total DECIMAL(18,2) NOT NULL DEFAULT 0,
            duration_type VARCHAR(30) NOT NULL DEFAULT '1m',
            max_activations INT UNSIGNED NOT NULL DEFAULT 1,
            status VARCHAR(30) NOT NULL DEFAULT 'active',
            is_test_sandbox TINYINT(1) NOT NULL DEFAULT 0,
            issued_at DATETIME NOT NULL,
            activated_at DATETIME NULL,
            expires_at DATETIME NULL,
            last_sync_at DATETIME NULL,
            signed_token LONGTEXT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY license_key (license_key),
            KEY app_id (app_id),
            KEY order_id (order_id),
            KEY user_id (user_id)
        ) {$charset};";

        $sql_activations = "CREATE TABLE {$activations_table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            app_id BIGINT UNSIGNED NOT NULL,
            license_id BIGINT UNSIGNED NULL,
            hardware_hash VARCHAR(128) NOT NULL,
            device_model VARCHAR(191) NOT NULL DEFAULT '',
            os_version VARCHAR(80) NOT NULL DEFAULT '',
            is_trial TINYINT(1) NOT NULL DEFAULT 0,
            trial_started_at DATETIME NULL,
            trial_expires_at DATETIME NULL,
            reinstall_attempts INT UNSIGNED NOT NULL DEFAULT 0,
            last_error_code VARCHAR(80) NOT NULL DEFAULT '',
            is_test_sandbox TINYINT(1) NOT NULL DEFAULT 0,
            last_seen_at DATETIME NOT NULL,
            client_last_clock BIGINT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            UNIQUE KEY app_hw_trial (app_id, hardware_hash, is_trial),
            KEY license_id (license_id)
        ) {$charset};";

        dbDelta( $sql_apps );
        dbDelta( $sql_licenses );
        dbDelta( $sql_activations );

        add_option( 'elm_calendar_settings', [
            'public' => '${opts.publicCalendar}',
            'admin'  => '${opts.adminCalendar}',
            'plugin' => '${opts.pluginCalendar}',
        ] );

        add_option( 'elm_wc_settings', [
            'trigger_statuses'             => [ ${triggerExport || "'completed'"} ],
            'conditional_cart_registration' => true,
            'store_domain'                 => '${opts.storeDomain}',
        ] );

        self::install_mu_patch();
        flush_rewrite_rules();
    }
}

register_activation_hook( __FILE__, [ Epic_License_Manager::class, 'activate' ] );
register_uninstall_hook( __FILE__, [ Epic_License_Manager::class, 'remove_mu_patch' ] );
Epic_License_Manager::instance();
`;
}

export function buildUninstallPhp(): string {
  return `<?php
/**
 * Uninstall cleanup for Epic License Manager.
 * Automatically removes the auto-installed mu-plugin patch file.
 */

declare(strict_types=1);

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
    exit;
}

$mu_dir = defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : ( WP_CONTENT_DIR . '/mu-plugins' );
$target = trailingslashit( $mu_dir ) . 'elm-plain-permalink-fix.php';

if ( file_exists( $target ) && is_writable( $target ) ) {
    @unlink( $target );
}
`;
}

export function buildCalendarPhp(): string {
  return `<?php
/**
 * Non-destructive Multi-Calendar Engine (Gregorian / Jalali / Hijri)
 * Hooks cleanly into WordPress & WooCommerce without modifying core files.
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class ELM_Calendar {

    private bool $is_converting = false;

    /** @var array<int, string> */
    private array $jalali_months_fa = [
        1 => 'فروردین', 2 => 'اردیبهشت', 3 => 'خرداد', 4 => 'تیر',
        5 => 'مرداد', 6 => 'شهریور', 7 => 'مهر', 8 => 'آبان',
        9 => 'آذر', 10 => 'دی', 11 => 'بهمن', 12 => 'اسفند',
    ];

    /** @var array<int, string> */
    private array $hijri_months_fa = [
        1 => 'محرم', 2 => 'صفر', 3 => 'ربیع‌الاول', 4 => 'ربیع‌الثانی',
        5 => 'جمادی‌الاول', 6 => 'جمادی‌الثانی', 7 => 'رجب', 8 => 'شعبان',
        9 => 'رمضان', 10 => 'شوال', 11 => 'ذیقعده', 12 => 'ذیحجه',
    ];

    public function __construct() {
        add_filter( 'wp_date', [ $this, 'filter_wp_date' ], 10, 4 );
        add_filter( 'date_i18n', [ $this, 'filter_date_i18n' ], 10, 4 );
        add_filter( 'woocommerce_format_datetime', [ $this, 'filter_wc_datetime' ], 10, 3 );
    }

    /**
     * @return array{public: string, admin: string, plugin: string}
     */
    public function get_settings(): array {
        $defaults = [
            'public' => 'jalali',
            'admin'  => 'gregorian',
            'plugin' => 'jalali',
        ];
        $saved = get_option( 'elm_calendar_settings', $defaults );
        if ( ! is_array( $saved ) ) {
            return $defaults;
        }
        return [
            'public' => in_array( $saved['public'] ?? '', [ 'gregorian', 'jalali', 'hijri' ], true ) ? (string) $saved['public'] : 'gregorian',
            'admin'  => in_array( $saved['admin'] ?? '', [ 'gregorian', 'jalali', 'hijri' ], true ) ? (string) $saved['admin'] : 'gregorian',
            'plugin' => in_array( $saved['plugin'] ?? '', [ 'gregorian', 'jalali', 'hijri' ], true ) ? (string) $saved['plugin'] : 'jalali',
        ];
    }

    public function get_active_calendar( string $context = 'auto' ): string {
        $settings = $this->get_settings();
        if ( 'plugin' === $context ) {
            return $settings['plugin'];
        }
        if ( is_admin() ) {
            $page = isset( $_GET['page'] ) ? sanitize_key( (string) wp_unslash( $_GET['page'] ) ) : '';
            if ( str_starts_with( $page, 'elm-' ) ) {
                return $settings['plugin'];
            }
            return $settings['admin'];
        }
        return $settings['public'];
    }

    public function filter_wp_date( string $date, string $format, int $timestamp, ?\\DateTimeZone $timezone ): string {
        if ( $this->is_converting || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || preg_match( '/[cUr]|Y-m-d|H:i:s/', $format ) ) {
            return $date;
        }
        $calendar = $this->get_active_calendar();
        return 'gregorian' === $calendar ? $date : $this->format_timestamp( $timestamp, $calendar, true );
    }

    public function filter_date_i18n( string $date, string $format, int $timestamp, bool $gmt ): string {
        if ( $this->is_converting || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || preg_match( '/[cUr]|Y-m-d|H:i:s/', $format ) ) {
            return $date;
        }
        $calendar = $this->get_active_calendar();
        return 'gregorian' === $calendar ? $date : $this->format_timestamp( $timestamp, $calendar, false );
    }

    public function filter_wc_datetime( string $formatted, \\WC_DateTime $datetime, string $format ): string {
        $calendar = $this->get_active_calendar();
        return 'gregorian' === $calendar ? $formatted : $this->format_timestamp( $datetime->getTimestamp(), $calendar, true );
    }

    public function format_mysql_datetime( ?string $mysql_dt, string $context = 'plugin', bool $with_time = false ): string {
        if ( empty( $mysql_dt ) ) {
            return '—';
        }
        $ts = strtotime( $mysql_dt . ' UTC' );
        if ( false === $ts ) {
            return $mysql_dt;
        }
        return $this->format_timestamp( $ts, $this->get_active_calendar( $context ), $with_time );
    }

    public function format_timestamp( int $timestamp, string $calendar, bool $with_time = false ): string {
        $this->is_converting = true;
        $gy = (int) gmdate( 'Y', $timestamp );
        $gm = (int) gmdate( 'n', $timestamp );
        $gd = (int) gmdate( 'j', $timestamp );
        $time = $with_time ? ' ' . gmdate( 'H:i', $timestamp ) : '';
        $this->is_converting = false;

        if ( 'jalali' === $calendar ) {
            [ $jy, $jm, $jd ] = self::gregorian_to_jalali( $gy, $gm, $gd );
            return sprintf( '%d %s %d%s', $jd, $this->jalali_months_fa[ $jm ] ?? (string) $jm, $jy, $time );
        }
        if ( 'hijri' === $calendar ) {
            [ $hy, $hm, $hd ] = self::gregorian_to_hijri( $gy, $gm, $gd );
            return sprintf( '%d %s %d%s', $hd, $this->hijri_months_fa[ $hm ] ?? (string) $hm, $hy, $time );
        }
        return gmdate( $with_time ? 'Y-m-d H:i' : 'Y-m-d', $timestamp );
    }

    /** @return array{0: int, 1: int, 2: int} */
    public static function gregorian_to_jalali( int $gy, int $gm, int $gd ): array {
        $g_d_m = [ 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334 ];
        $gy2   = ( $gm > 2 ) ? ( $gy + 1 ) : $gy;
        $days  = 355666 + ( 365 * $gy ) + intdiv( $gy2 + 3, 4 ) - intdiv( $gy2 + 99, 100 ) + intdiv( $gy2 + 399, 400 ) + $gd + $g_d_m[ $gm - 1 ];
        $jy    = -1595 + ( 33 * intdiv( $days, 12053 ) );
        $days %= 12053;
        $jy   += 4 * intdiv( $days, 1461 );
        $days %= 1461;
        if ( $days > 365 ) {
            $jy  += intdiv( $days - 1, 365 );
            $days = ( $days - 1 ) % 365;
        }
        $jm = ( $days < 186 ) ? ( 1 + intdiv( $days, 31 ) ) : ( 7 + intdiv( $days - 186, 30 ) );
        $jd = 1 + ( ( $days < 186 ) ? ( $days % 31 ) : ( ( $days - 186 ) % 30 ) );
        return [ $jy, $jm, $jd ];
    }

    /** @return array{0: int, 1: int, 2: int} */
    public static function gregorian_to_hijri( int $gy, int $gm, int $gd ): array {
        if ( $gm < 3 ) { --$gy; $gm += 12; }
        $a  = intdiv( $gy, 100 );
        $b  = 2 - $a + intdiv( $a, 4 );
        $jd = (int) ( floor( 365.25 * ( $gy + 4716 ) ) + floor( 30.6001 * ( $gm + 1 ) ) + $gd + $b - 1524 );
        $l  = $jd - 1948440 + 10632;
        $n  = intdiv( $l - 1, 10631 );
        $l2 = $l - 10631 * $n + 354;
        $j  = intdiv( 10985 - $l2, 5316 ) * intdiv( 50 * $l2, 17719 ) + intdiv( $l2, 5670 ) * intdiv( 43 * $l2, 15238 );
        $l2 = $l2 - intdiv( 30 - $j, 15 ) * intdiv( 17719 * $j, 50 ) - intdiv( $j, 16 ) * intdiv( 15238 * $j, 43 ) + 29;
        $hm = intdiv( 24 * $l2, 709 );
        $hd = $l2 - intdiv( 709 * $hm, 24 );
        $hy = 30 * $n + $j - 30;
        return [ $hy, $hm, $hd ];
    }
}
`;
}

export function buildCryptoPhp(): string {
  return `<?php
/**
 * Cryptographic Offline Token Engine (PHP 8.2 Sodium Ed25519 Default)
 * - Generates Ed25519 keypairs with simultaneous 64-char Hex & Base64 representations
 * - Supports custom keypair editing / deterministic seed import & live signature testing
 * - Reports explicit admin warning if PHP sodium extension is disabled on host
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class ELM_Crypto {

    public function is_sodium_available(): bool {
        return function_exists( 'sodium_crypto_sign_keypair' )
            && function_exists( 'sodium_crypto_sign_detached' )
            && function_exists( 'sodium_crypto_sign_verify_detached' );
    }

    /**
     * @return array{alg: string, public_key_b64: string, public_key_hex: string, private_key_b64: string}
     */
    public function generate_app_keypair( ?string $seed_hex = null ): array {
        if ( ! $this->is_sodium_available() ) {
            return [
                'alg'             => 'sodium_missing',
                'public_key_b64'  => '',
                'public_key_hex'  => '',
                'private_key_b64' => '',
            ];
        }

        if ( null !== $seed_hex && preg_match( '/^[0-9a-fA-F]{64}$/', $seed_hex ) ) {
            $seed_bin = hex2bin( $seed_hex );
            $pair     = sodium_crypto_sign_seed_keypair( $seed_bin );
        } else {
            $pair = sodium_crypto_sign_keypair();
        }

        $pub_bin  = sodium_crypto_sign_publickey( $pair );
        $priv_bin = sodium_crypto_sign_secretkey( $pair );

        return [
            'alg'             => 'ed25519',
            'public_key_b64'  => base64_encode( $pub_bin ),
            'public_key_hex'  => bin2hex( $pub_bin ),
            'private_key_b64' => base64_encode( $priv_bin ),
        ];
    }

    public function b64_to_hex( string $b64 ): string {
        $bin = base64_decode( $b64, true );
        return ( false !== $bin ) ? bin2hex( $bin ) : '';
    }

    public function hex_to_b64( string $hex ): string {
        $clean = trim( $hex );
        if ( ! preg_match( '/^[0-9a-fA-F]{64}$/', $clean ) ) {
            return '';
        }
        $bin = hex2bin( $clean );
        return ( false !== $bin ) ? base64_encode( $bin ) : '';
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function sign_token( array $payload, string $private_key_b64 ): string {
        $json        = (string) wp_json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
        $payload_b64 = rtrim( strtr( base64_encode( $json ), '+/', '-_' ), '=' );

        if ( $this->is_sodium_available() ) {
            $secret_bin = base64_decode( $private_key_b64, true );
            if ( is_string( $secret_bin ) && strlen( $secret_bin ) === SODIUM_CRYPTO_SIGN_SECRETKEYBYTES ) {
                $sig_bin = sodium_crypto_sign_detached( $payload_b64, $secret_bin );
                $sig_b64 = rtrim( strtr( base64_encode( $sig_bin ), '+/', '-_' ), '=' );
                return $payload_b64 . '.' . $sig_b64;
            }
        }
        return '';
    }

    /**
     * Verifies a signed token against either 64-char Hex or Base64 Ed25519 public key.
     *
     * @return array{valid: bool, error: string, payload: array<string, mixed>|null}
     */
    public function verify_token_with_key( string $token, string $public_key_hex_or_b64 ): array {
        if ( ! $this->is_sodium_available() ) {
            return [ 'valid' => false, 'error' => 'PHP Sodium extension is not enabled on this server.', 'payload' => null ];
        }
        $parts = explode( '.', trim( $token ) );
        if ( count( $parts ) !== 2 ) {
            return [ 'valid' => false, 'error' => 'Malformed token format.', 'payload' => null ];
        }
        [ $payload_b64, $sig_b64 ] = $parts;
        $sig_bin = base64_decode( strtr( $sig_b64, '-_', '+/' ) . str_repeat( '=', ( 4 - strlen( $sig_b64 ) % 4 ) % 4 ), true );

        $key_clean = trim( $public_key_hex_or_b64 );
        if ( preg_match( '/^[0-9a-fA-F]{64}$/', $key_clean ) ) {
            $pub_bin = hex2bin( $key_clean );
        } else {
            $pub_bin = base64_decode( $key_clean, true );
        }

        if ( ! is_string( $pub_bin ) || strlen( $pub_bin ) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES || ! is_string( $sig_bin ) ) {
            return [ 'valid' => false, 'error' => 'Invalid Ed25519 public key length (must be 64 Hex chars or 32-byte Base64).', 'payload' => null ];
        }

        $ok = sodium_crypto_sign_verify_detached( $sig_bin, $payload_b64, $pub_bin );
        $json = base64_decode( strtr( $payload_b64, '-_', '+/' ) . str_repeat( '=', ( 4 - strlen( $payload_b64 ) % 4 ) % 4 ), true );
        $decoded = is_string( $json ) ? json_decode( $json, true ) : null;

        return [
            'valid'   => $ok,
            'error'   => $ok ? '' : 'Cryptographic signature mismatch between token and provided Public Key.',
            'payload' => is_array( $decoded ) ? $decoded : null,
        ];
    }

    public function generate_license_key( string $prefix = 'ELM' ): string {
        $segments = [];
        for ( $i = 0; $i < 4; $i++ ) {
            $segments[] = strtoupper( bin2hex( random_bytes( 2 ) ) );
        }
        $clean = preg_replace( '/[^A-Z0-9]/', '', strtoupper( $prefix ) ) ?: 'ELM';
        return $clean . '-' . implode( '-', $segments );
    }
}
`;
}
