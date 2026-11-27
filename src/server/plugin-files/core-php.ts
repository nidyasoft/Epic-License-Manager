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
 * Description:       Enterprise WooCommerce License & Trial Manager with Ed25519 Offline Tokens, Multi-Calendar (Gregorian/Jalali/Hijri), Bundle Variations (1-10 Keys), HTML Mobile Promos, and ACF Dynamic Reporting.
 * Version:           1.0.0
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

define( 'ELM_VERSION', '1.0.0' );
define( 'ELM_PLUGIN_FILE', __FILE__ );
define( 'ELM_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'ELM_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// Declare WooCommerce High-Performance Order Storage (HPOS) compatibility cleanly.
add_action( 'before_woocommerce_init', static function (): void {
    if ( class_exists( \\Automattic\\WooCommerce\\Utilities\\FeaturesUtil::class ) ) {
        \\Automattic\\WooCommerce\\Utilities\\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
    }
} );

require_once ELM_PLUGIN_DIR . 'includes/class-elm-calendar.php';
require_once ELM_PLUGIN_DIR . 'includes/class-elm-crypto.php';
require_once ELM_PLUGIN_DIR . 'includes/class-elm-woocommerce.php';
require_once ELM_PLUGIN_DIR . 'includes/class-elm-rest-api.php';
require_once ELM_PLUGIN_DIR . 'includes/class-elm-reports.php';
require_once ELM_PLUGIN_DIR . 'includes/class-elm-admin.php';

final class Epic_License_Manager {

    private static ?self $instance = null;

    public ELM_Calendar $calendar;
    public ELM_Crypto $crypto;
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

        $this->calendar    = new ELM_Calendar();
        $this->crypto      = new ELM_Crypto();
        $this->woocommerce = new ELM_WooCommerce( $this->crypto );
        $this->rest_api    = new ELM_Rest_API( $this->crypto );
        $this->reports     = new ELM_Reports( $this->calendar );
        $this->admin       = new ELM_Admin( $this->calendar, $this->crypto, $this->reports );
    }

    public function load_textdomain(): void {
        load_plugin_textdomain(
            'epic-license-manager',
            false,
            dirname( plugin_basename( ELM_PLUGIN_FILE ) ) . '/languages'
        );
    }

    public static function activate(): void {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $charset = $wpdb->get_charset_collate();

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
            private_key TEXT NOT NULL,
            purchase_url VARCHAR(500) NOT NULL DEFAULT '',
            gated_features LONGTEXT NULL,
            promo_enabled TINYINT(1) NOT NULL DEFAULT 1,
            promo_display_mode VARCHAR(40) NOT NULL DEFAULT 'floating_modal',
            promo_interval_sec INT UNSIGNED NOT NULL DEFAULT 180,
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
            duration_type VARCHAR(30) NOT NULL DEFAULT '1m',
            max_activations INT UNSIGNED NOT NULL DEFAULT 1,
            status VARCHAR(30) NOT NULL DEFAULT 'active',
            issued_at DATETIME NOT NULL,
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
            'trigger_statuses'    => [ ${triggerExport || "'completed'"} ],
            'block_guest'         => true,
            'require_first_name'  => true,
            'require_last_name'   => true,
            'require_mobile'      => true,
            'require_email'       => true,
            'store_domain'        => '${opts.storeDomain}',
        ] );
    }
}

register_activation_hook( __FILE__, [ Epic_License_Manager::class, 'activate' ] );
Epic_License_Manager::instance();
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
        if ( $this->is_converting ) {
            return $date;
        }
        // Keep ISO-8601 / machine formats untouched so APIs & HTML datetime attributes stay valid.
        if ( preg_match( '/[cUr]|Y-m-d/', $format ) ) {
            return $date;
        }
        $calendar = $this->get_active_calendar();
        if ( 'gregorian' === $calendar ) {
            return $date;
        }
        return $this->format_timestamp( $timestamp, $calendar, true );
    }

    public function filter_date_i18n( string $date, string $format, int $timestamp, bool $gmt ): string {
        if ( $this->is_converting ) {
            return $date;
        }
        if ( preg_match( '/[cUr]|Y-m-d/', $format ) ) {
            return $date;
        }
        $calendar = $this->get_active_calendar();
        if ( 'gregorian' === $calendar ) {
            return $date;
        }
        return $this->format_timestamp( $timestamp, $calendar, false );
    }

    public function filter_wc_datetime( string $formatted, \\WC_DateTime $datetime, string $format ): string {
        $calendar = $this->get_active_calendar();
        if ( 'gregorian' === $calendar ) {
            return $formatted;
        }
        return $this->format_timestamp( $datetime->getTimestamp(), $calendar, true );
    }

    public function format_mysql_datetime( ?string $mysql_dt, string $context = 'plugin', bool $with_time = false ): string {
        if ( empty( $mysql_dt ) ) {
            return '—';
        }
        $ts = strtotime( $mysql_dt . ' UTC' );
        if ( false === $ts ) {
            return $mysql_dt;
        }
        $calendar = $this->get_active_calendar( $context );
        return $this->format_timestamp( $ts, $calendar, $with_time );
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
            $month = $this->jalali_months_fa[ $jm ] ?? (string) $jm;
            return sprintf( '%d %s %d%s', $jd, $month, $jy, $time );
        }

        if ( 'hijri' === $calendar ) {
            [ $hy, $hm, $hd ] = self::gregorian_to_hijri( $gy, $gm, $gd );
            $month = $this->hijri_months_fa[ $hm ] ?? (string) $hm;
            return sprintf( '%d %s %d%s', $hd, $month, $hy, $time );
        }

        return gmdate( $with_time ? 'Y-m-d H:i' : 'Y-m-d', $timestamp );
    }

    /**
     * @return array{0: int, 1: int, 2: int}
     */
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

    /**
     * @return array{0: int, 1: int, 2: int}
     */
    public static function gregorian_to_hijri( int $gy, int $gm, int $gd ): array {
        if ( $gm < 3 ) {
            --$gy;
            $gm += 12;
        }
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
 * Cryptographic Offline Token Engine (Ed25519 via PHP 8.2 sodium, with HMAC-SHA256 fallback).
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class ELM_Crypto {

    /**
     * @return array{alg: string, public_key: string, private_key: string}
     */
    public function generate_app_keypair(): array {
        if ( function_exists( 'sodium_crypto_sign_keypair' ) ) {
            $pair = sodium_crypto_sign_keypair();
            return [
                'alg'         => 'ed25519',
                'public_key'  => base64_encode( sodium_crypto_sign_publickey( $pair ) ),
                'private_key' => base64_encode( sodium_crypto_sign_secretkey( $pair ) ),
            ];
        }
        $secret = bin2hex( random_bytes( 32 ) );
        return [
            'alg'         => 'hmac-sha256',
            'public_key'  => hash( 'sha256', $secret ),
            'private_key' => $secret,
        ];
    }

    /**
     * Signs an offline-verifiable license/trial payload.
     *
     * @param array<string, mixed> $payload
     */
    public function sign_token( array $payload, string $private_key_b64 ): string {
        $json        = (string) wp_json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
        $payload_b64 = rtrim( strtr( base64_encode( $json ), '+/', '-_' ), '=' );

        if ( function_exists( 'sodium_crypto_sign_detached' ) && strlen( base64_decode( $private_key_b64, true ) ?: '' ) === SODIUM_CRYPTO_SIGN_SECRETKEYBYTES ) {
            $secret_bin = base64_decode( $private_key_b64, true );
            $sig_bin    = sodium_crypto_sign_detached( $payload_b64, $secret_bin );
            $sig_b64    = rtrim( strtr( base64_encode( $sig_bin ), '+/', '-_' ), '=' );
            return $payload_b64 . '.' . $sig_b64;
        }

        $hmac = hash_hmac( 'sha256', $payload_b64, $private_key_b64, true );
        $sig_b64 = rtrim( strtr( base64_encode( $hmac ), '+/', '-_' ), '=' );
        return $payload_b64 . '.' . $sig_b64;
    }

    public function generate_license_key( string $prefix = 'ELM' ): string {
        $segments = [];
        for ( $i = 0; $i < 4; $i++ ) {
            $segments[] = strtoupper( bin2hex( random_bytes( 2 ) ) );
        }
        return sanitize_key( strtoupper( $prefix ) ) ? strtoupper( $prefix ) . '-' . implode( '-', $segments ) : 'ELM-' . implode( '-', $segments );
    }
}
`;
}
