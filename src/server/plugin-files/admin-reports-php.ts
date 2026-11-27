export function buildReportsPhp(): string {
  return `<?php
/**
 * Comprehensive Reporting & True OOXML (.xlsx) + Persian Semicolon BOM (.csv) Export Engine
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class ELM_Reports {

    private ELM_Calendar $calendar;
    private ELM_Custom_Fields $custom_fields;

    public function __construct( ELM_Calendar $calendar, ELM_Custom_Fields $custom_fields ) {
        $this->calendar      = $calendar;
        $this->custom_fields = $custom_fields;
        add_action( 'admin_post_elm_export_report', [ $this, 'handle_export' ] );
    }

    /**
     * @return array<string, array{label: string, source: string}>
     */
    public function get_available_extra_columns(): array {
        $columns = [
            'wc_billing_city'    => [ 'label' => __( 'شهر صورتحساب (WC)', 'epic-license-manager' ), 'source' => 'woocommerce' ],
            'wc_billing_company' => [ 'label' => __( 'شرکت / سازمان (WC)', 'epic-license-manager' ), 'source' => 'woocommerce' ],
            'wp_user_registered' => [ 'label' => __( 'تاریخ عضویت کاربر (WP)', 'epic-license-manager' ), 'source' => 'wordpress' ],
        ];

        foreach ( $this->custom_fields->get_groups() as $group ) {
            foreach ( (array) ( $group['fields'] ?? [] ) as $field ) {
                if ( ! empty( $field['showInReport'] ) && ! empty( $field['name'] ) ) {
                    $k = 'elmcf_' . sanitize_key( (string) $field['name'] );
                    $columns[ $k ] = [
                        'label'  => sprintf( '%s (ELM Field)', (string) ( $field['label'] ?? $field['name'] ) ),
                        'source' => 'elm_cf',
                    ];
                }
            }
        }

        if ( function_exists( 'acf_get_field_groups' ) && function_exists( 'acf_get_fields' ) ) {
            $groups = acf_get_field_groups( [ 'user_form' => 'edit' ] );
            if ( empty( $groups ) ) {
                $groups = acf_get_field_groups();
            }
            if ( is_array( $groups ) ) {
                foreach ( $groups as $group ) {
                    $fields = acf_get_fields( $group['key'] );
                    if ( is_array( $fields ) ) {
                        foreach ( $fields as $field ) {
                            $name = (string) ( $field['name'] ?? '' );
                            if ( '' !== $name ) {
                                $columns[ 'acf_' . $name ] = [
                                    'label'  => sprintf( '%s (ACF)', (string) ( $field['label'] ?? $name ) ),
                                    'source' => 'acf',
                                ];
                            }
                        }
                    }
                }
            }
        }

        return $columns;
    }

    /**
     * @return array{total_revenue: float, total_licenses: int, active_licenses: int, expired_licenses: int, active_trials: int, sandbox_records: int}
     */
    public function get_summary_stats(): array {
        global $wpdb;
        $lic_table = $wpdb->prefix . 'elm_licenses';
        $act_table = $wpdb->prefix . 'elm_activations';

        $total_rev   = (float) $wpdb->get_var( "SELECT COALESCE(SUM(order_total), 0) FROM {$lic_table} WHERE is_test_sandbox = 0" );
        $total_lic   = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$lic_table} WHERE is_test_sandbox = 0" );
        $active_lic  = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$lic_table} WHERE status = 'active' AND is_test_sandbox = 0" );
        $expired_lic = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$lic_table} WHERE status = 'expired' AND is_test_sandbox = 0" );
        $active_tr   = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$act_table} WHERE is_trial = 1 AND trial_expires_at > UTC_TIMESTAMP() AND is_test_sandbox = 0" );
        $sandbox_cnt = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$act_table} WHERE is_test_sandbox = 1" )
                     + (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$lic_table} WHERE is_test_sandbox = 1" );

        return [
            'total_revenue'    => $total_rev,
            'total_licenses'   => $total_lic,
            'active_licenses'  => $active_lic,
            'expired_licenses' => $expired_lic,
            'active_trials'    => $active_tr,
            'sandbox_records'  => $sandbox_cnt,
        ];
    }

    /**
     * @param array<string, mixed> $args
     * @return array<int, array<string, mixed>>
     */
    public function query_licenses( array $args = [] ): array {
        global $wpdb;
        $lic_table = $wpdb->prefix . 'elm_licenses';
        $app_table = $wpdb->prefix . 'elm_apps';
        $act_table = $wpdb->prefix . 'elm_activations';

        $where  = [ '1=1' ];
        $params = [];

        if ( empty( $args['include_sandbox'] ) ) {
            $where[] = 'l.is_test_sandbox = 0';
        }
        if ( ! empty( $args['app_id'] ) ) {
            $where[]  = 'l.app_id = %d';
            $params[] = (int) $args['app_id'];
        }
        if ( ! empty( $args['status'] ) ) {
            $where[]  = 'l.status = %s';
            $params[] = sanitize_key( (string) $args['status'] );
        }
        if ( ! empty( $args['duration'] ) ) {
            $where[]  = 'l.duration_type = %s';
            $params[] = sanitize_key( (string) $args['duration'] );
        }
        if ( ! empty( $args['date_from'] ) ) {
            $where[]  = 'l.issued_at >= %s';
            $params[] = sanitize_text_field( (string) $args['date_from'] ) . ' 00:00:00';
        }
        if ( ! empty( $args['date_to'] ) ) {
            $where[]  = 'l.issued_at <= %s';
            $params[] = sanitize_text_field( (string) $args['date_to'] ) . ' 23:59:59';
        }
        if ( ! empty( $args['search'] ) ) {
            $like     = '%' . $wpdb->esc_like( (string) $args['search'] ) . '%';
            $where[]  = '(l.license_key LIKE %s OR l.customer_email LIKE %s OR l.customer_name LIKE %s OR l.customer_mobile LIKE %s OR act.hardware_hash LIKE %s)';
            array_push( $params, $like, $like, $like, $like, $like );
        }

        $sql = "SELECT l.*, a.app_name, u.user_email, u.user_registered,
                       act.hardware_hash, act.device_model, act.os_version, act.reinstall_attempts, act.last_error_code
                FROM {$lic_table} l
                INNER JOIN {$app_table} a ON a.id = l.app_id
                LEFT JOIN {$wpdb->users} u ON u.ID = l.user_id
                LEFT JOIN {$act_table} act ON act.license_id = l.id AND act.is_trial = 0
                WHERE " . implode( ' AND ', $where ) . "
                ORDER BY l.id DESC
                LIMIT 1000";

        if ( ! empty( $params ) ) {
            $sql = $wpdb->prepare( $sql, ...$params );
        }

        $rows          = $wpdb->get_results( $sql );
        $extra_columns = is_array( $args['extra_columns'] ?? null ) ? $args['extra_columns'] : [];
        $result        = [];

        if ( ! is_array( $rows ) ) {
            return $result;
        }

        foreach ( $rows as $row ) {
            $uid        = (int) $row->user_id;
            $first_name = $uid > 0 ? (string) get_user_meta( $uid, 'first_name', true ) : '';
            $last_name  = $uid > 0 ? (string) get_user_meta( $uid, 'last_name', true ) : '';
            $cust_name  = trim( $first_name . ' ' . $last_name ) ?: ( (string) $row->customer_name ?: '—' );
            $mobile     = ( $uid > 0 ? (string) get_user_meta( $uid, 'billing_phone', true ) : '' ) ?: ( (string) $row->customer_mobile ?: '—' );
            $email      = (string) ( $row->user_email ?: ( $row->customer_email ?: '—' ) );

            $item = [
                'id'                 => (int) $row->id,
                'license_key'        => (string) $row->license_key,
                'app_name'           => (string) $row->app_name,
                'order_id'           => (int) $row->order_id,
                'product_title'      => (string) ( $row->product_title ?: '—' ),
                'order_total'        => number_format( (float) $row->order_total ),
                'payment_method'     => (string) ( $row->payment_method ?: '—' ),
                'duration'           => (string) $row->duration_type,
                'status'             => (string) $row->status,
                'is_test_sandbox'    => (int) $row->is_test_sandbox,
                'customer_name'      => $cust_name,
                'customer_mobile'    => $mobile,
                'customer_email'     => $email,
                'device_model'       => (string) ( $row->device_model ?: '—' ),
                'os_version'         => (string) ( $row->os_version ?: '—' ),
                'hardware_hash'      => (string) ( $row->hardware_hash ?: '—' ),
                'issued_at'          => $this->calendar->format_mysql_datetime( (string) $row->issued_at, 'plugin', true ),
                'activated_at'       => $this->calendar->format_mysql_datetime( $row->activated_at ? (string) $row->activated_at : null, 'plugin', true ),
                'last_sync_at'       => $this->calendar->format_mysql_datetime( $row->last_sync_at ? (string) $row->last_sync_at : null, 'plugin', true ),
                'expires_at'         => $row->expires_at ? $this->calendar->format_mysql_datetime( (string) $row->expires_at, 'plugin', false ) : __( 'دائمی (Lifetime)', 'epic-license-manager' ),
                'remaining'          => $this->compute_remaining( $row->expires_at ? (string) $row->expires_at : null ),
                'reinstall_attempts' => (int) ( $row->reinstall_attempts ?? 0 ),
                'last_error_code'    => (string) ( $row->last_error_code ?: '—' ),
                'signed_token'       => (string) ( $row->signed_token ?? '' ),
            ];

            foreach ( $extra_columns as $col_key ) {
                $col_key = sanitize_key( (string) $col_key );
                if ( 'wc_billing_city' === $col_key ) {
                    $item[ $col_key ] = $uid > 0 ? (string) ( get_user_meta( $uid, 'billing_city', true ) ?: '—' ) : '—';
                } elseif ( 'wc_billing_company' === $col_key ) {
                    $item[ $col_key ] = $uid > 0 ? (string) ( get_user_meta( $uid, 'billing_company', true ) ?: '—' ) : '—';
                } elseif ( 'wp_user_registered' === $col_key ) {
                    $item[ $col_key ] = $this->calendar->format_mysql_datetime( (string) $row->user_registered, 'plugin', false );
                } elseif ( str_starts_with( $col_key, 'elmcf_' ) ) {
                    $cf_name = substr( $col_key, 6 );
                    $val     = $this->custom_fields->get_field_value( $cf_name, $uid, 'user' );
                    $item[ $col_key ] = is_scalar( $val ) ? (string) ( $val ?: '—' ) : ( is_array( $val ) ? implode( '، ', $val ) : '—' );
                } elseif ( str_starts_with( $col_key, 'acf_' ) && function_exists( 'get_field' ) && $uid > 0 ) {
                    $val = get_field( substr( $col_key, 4 ), 'user_' . $uid );
                    $item[ $col_key ] = is_scalar( $val ) ? (string) $val : ( is_array( $val ) ? implode( '، ', $val ) : '—' );
                }
            }

            $result[] = $item;
        }

        return $result;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function query_trials( bool $include_sandbox = true ): array {
        global $wpdb;
        $act_table = $wpdb->prefix . 'elm_activations';
        $app_table = $wpdb->prefix . 'elm_apps';
        $where     = $include_sandbox ? 'act.is_trial = 1' : 'act.is_trial = 1 AND act.is_test_sandbox = 0';
        $rows      = $wpdb->get_results(
            "SELECT act.*, a.app_name, a.app_slug
             FROM {$act_table} act
             INNER JOIN {$app_table} a ON a.id = act.app_id
             WHERE {$where}
             ORDER BY act.id DESC
             LIMIT 100"
        );
        $out = [];
        if ( ! is_array( $rows ) ) {
            return $out;
        }
        foreach ( $rows as $r ) {
            $out[] = [
                'app_name'           => (string) $r->app_name,
                'hardware_hash'      => (string) $r->hardware_hash,
                'device_model'       => (string) ( $r->device_model ?: '—' ),
                'os_version'         => (string) ( $r->os_version ?: '—' ),
                'trial_started_at'   => $this->calendar->format_mysql_datetime( $r->trial_started_at ? (string) $r->trial_started_at : null, 'plugin', true ),
                'trial_expires_at'   => $this->calendar->format_mysql_datetime( $r->trial_expires_at ? (string) $r->trial_expires_at : null, 'plugin', true ),
                'remaining'          => $this->compute_remaining( $r->trial_expires_at ? (string) $r->trial_expires_at : null ),
                'reinstall_attempts' => (int) $r->reinstall_attempts,
                'last_error_code'    => (string) ( $r->last_error_code ?: '—' ),
                'is_test_sandbox'    => (int) $r->is_test_sandbox,
            ];
        }
        return $out;
    }

    private function compute_remaining( ?string $expires_mysql ): string {
        if ( null === $expires_mysql || '' === $expires_mysql ) {
            return __( 'دائمی (Lifetime)', 'epic-license-manager' );
        }
        $diff = ( strtotime( $expires_mysql . ' UTC' ) ?: 0 ) - time();
        if ( $diff <= 0 ) {
            return __( 'منقضی شده', 'epic-license-manager' );
        }
        $days  = intdiv( $diff, DAY_IN_SECONDS );
        $hours = intdiv( $diff % DAY_IN_SECONDS, HOUR_IN_SECONDS );
        return sprintf( '%d روز و %d ساعت', $days, $hours );
    }

    public function handle_export(): void {
        if ( ! current_user_can( 'manage_options' ) && ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html__( 'Unauthorized.', 'epic-license-manager' ) );
        }
        check_admin_referer( 'elm_export_report_nonce' );

        $format = isset( $_GET['format'] ) && 'csv' === $_GET['format'] ? 'csv' : 'xlsx';
        $extra  = isset( $_GET['extra_columns'] ) && is_array( $_GET['extra_columns'] )
            ? array_map( 'sanitize_key', wp_unslash( $_GET['extra_columns'] ) )
            : [];

        $rows = $this->query_licenses( [
            'app_id'          => isset( $_GET['app_id'] ) ? absint( $_GET['app_id'] ) : 0,
            'status'          => isset( $_GET['status'] ) ? sanitize_key( (string) wp_unslash( $_GET['status'] ) ) : '',
            'duration'        => isset( $_GET['duration'] ) ? sanitize_key( (string) wp_unslash( $_GET['duration'] ) ) : '',
            'date_from'       => isset( $_GET['date_from'] ) ? sanitize_text_field( (string) wp_unslash( $_GET['date_from'] ) ) : '',
            'date_to'         => isset( $_GET['date_to'] ) ? sanitize_text_field( (string) wp_unslash( $_GET['date_to'] ) ) : '',
            'search'          => isset( $_GET['search'] ) ? sanitize_text_field( (string) wp_unslash( $_GET['search'] ) ) : '',
            'include_sandbox' => ! empty( $_GET['include_sandbox'] ),
            'extra_columns'   => $extra,
        ] );

        $label_map = [
            'license_key'        => 'کلید لایسنس',
            'app_name'           => 'اپلیکیشن',
            'order_id'           => 'شماره سفارش',
            'product_title'      => 'عنوان محصول / متغیر',
            'order_total'        => 'مبلغ سفارش',
            'payment_method'     => 'درگاه پرداخت',
            'duration'           => 'پلن زمانی',
            'status'             => 'وضعیت لایسنس',
            'customer_name'      => 'نام مشتری',
            'customer_mobile'    => 'شماره موبایل',
            'customer_email'     => 'ایمیل',
            'device_model'       => 'مدل دستگاه',
            'os_version'         => 'سیستم‌عامل',
            'hardware_hash'      => 'هش سخت‌افزار',
            'issued_at'          => 'تاریخ صدور',
            'activated_at'       => 'تاریخ فعال‌سازی',
            'last_sync_at'       => 'آخرین همگام‌سازی',
            'expires_at'         => 'تاریخ انقضا',
            'remaining'          => 'زمان باقی‌مانده',
            'reinstall_attempts' => 'تلاش نصب مجدد',
            'last_error_code'    => 'آخرین کد خطا',
        ];
        $extra_defs = $this->get_available_extra_columns();
        foreach ( $extra as $ek ) {
            if ( isset( $extra_defs[ $ek ] ) ) {
                $label_map[ $ek ] = $extra_defs[ $ek ]['label'];
            }
        }

        $export_keys = array_keys( $label_map );
        $headers     = array_values( $label_map );
        $table_rows  = [];
        foreach ( $rows as $r ) {
            $line = [];
            foreach ( $export_keys as $k ) {
                $line[] = (string) ( $r[ $k ] ?? '—' );
            }
            $table_rows[] = $line;
        }

        if ( 'csv' === $format || ! class_exists( '\\ZipArchive' ) ) {
            header( 'Content-Type: text/csv; charset=UTF-8' );
            header( 'Content-Disposition: attachment; filename="epic-licenses-' . gmdate( 'Y-m-d' ) . '.csv"' );
            echo "\\xEF\\xBB\\xBFsep=;\\r\\n";
            $out = fopen( 'php://output', 'w' );
            if ( false !== $out ) {
                fputcsv( $out, $headers, ';' );
                foreach ( $table_rows as $r ) {
                    fputcsv( $out, $r, ';' );
                }
                fclose( $out );
            }
            exit;
        }

        $temp_file = wp_tempnam( 'elm-export.xlsx' );
        $zip       = new \\ZipArchive();
        $zip->open( $temp_file, \\ZipArchive::CREATE | \\ZipArchive::OVERWRITE );

        $zip->addFromString( '[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' );
        $zip->addFromString( '_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' );
        $zip->addFromString( 'xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' );
        $zip->addFromString( 'xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="EpicLicenses" sheetId="1" r:id="rId1"/></sheets></workbook>' );
        $zip->addFromString( 'xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F4C81"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>' );

        $sheet_rows = '';
        $all_data   = array_merge( [ $headers ], $table_rows );
        foreach ( $all_data as $r_idx => $row_vals ) {
            $r_num = $r_idx + 1;
            $style = 0 === $r_idx ? 1 : 2;
            $cells = '';
            foreach ( $row_vals as $c_idx => $cell_val ) {
                $col_ref = $this->col_letter( (int) $c_idx ) . $r_num;
                $esc_val = htmlspecialchars( (string) $cell_val, ENT_XML1 | ENT_COMPAT, 'UTF-8' );
                $cells  .= '<c r="' . $col_ref . '" t="inlineStr" s="' . $style . '"><is><t xml:space="preserve">' . $esc_val . '</t></is></c>';
            }
            $sheet_rows .= '<row r="' . $r_num . '">' . $cells . '</row>';
        }
        $sheet_xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView tabSelected="1" rightToLeft="1" workbookViewId="0"/></sheetViews><sheetData>' . $sheet_rows . '</sheetData></worksheet>';
        $zip->addFromString( 'xl/worksheets/sheet1.xml', $sheet_xml );
        $zip->close();

        header( 'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' );
        header( 'Content-Disposition: attachment; filename="epic-licenses-' . gmdate( 'Y-m-d' ) . '.xlsx"' );
        header( 'Content-Length: ' . (string) filesize( $temp_file ) );
        readfile( $temp_file );
        @unlink( $temp_file );
        exit;
    }

    private function col_letter( int $index ): string {
        $col = '';
        while ( $index >= 0 ) {
            $col   = chr( ( $index % 26 ) + 65 ) . $col;
            $index = intdiv( $index, 26 ) - 1;
        }
        return $col;
    }
}
`;
}

export function buildAdminPhp(): string {
  return `<?php
/**
 * Complete WordPress Admin Studio for Epic License Manager v2
 * Dedicated Submenus + Unified Studio Tabs:
 * - Reports & True Persian XLSX
 * - Apps, Manifest Import & Ed25519 Key Sync
 * - ACF-Style Conditional Custom Fields Visual Builder
 * - Visual HTML Promo Studio & WooCommerce Variation Picker (CPT elm_promo)
 * - In-WordPress Modern Phone Simulator & Live REST API Tester
 * - Real Kotlin / Web / Manifest / Google AI Studio Prompt Builder
 * - Triple Calendars, Conditional Cart Registration & MU-Patch Diagnostics
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class ELM_Admin {

    private ELM_Calendar $calendar;
    private ELM_Crypto $crypto;
    private ELM_Reports $reports;
    private ELM_Custom_Fields $custom_fields;
    private ELM_Promo_CPT $promo_cpt;

    public function __construct(
        ELM_Calendar $calendar,
        ELM_Crypto $crypto,
        ELM_Reports $reports,
        ELM_Custom_Fields $custom_fields,
        ELM_Promo_CPT $promo_cpt
    ) {
        $this->calendar      = $calendar;
        $this->crypto        = $crypto;
        $this->reports       = $reports;
        $this->custom_fields = $custom_fields;
        $this->promo_cpt     = $promo_cpt;

        add_action( 'admin_menu', [ $this, 'register_menu' ], 20 );
        add_action( 'admin_menu', [ $this, 'ensure_menu_order' ], 99 );
        add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_assets' ] );
        add_action( 'admin_notices', [ $this, 'render_sodium_and_permalink_notice' ] );

        // Admin Post Handlers
        add_action( 'admin_post_elm_save_settings', [ $this, 'handle_save_settings' ] );
        add_action( 'admin_post_elm_reinstall_mu_patch', [ $this, 'handle_reinstall_mu_patch' ] );
        add_action( 'admin_post_elm_save_app', [ $this, 'handle_save_app' ] );
        add_action( 'admin_post_elm_toggle_app', [ $this, 'handle_toggle_app' ] );
        add_action( 'admin_post_elm_toggle_license', [ $this, 'handle_toggle_license' ] );
        add_action( 'admin_post_elm_save_cf_group', [ $this, 'handle_save_cf_group' ] );
        add_action( 'admin_post_elm_delete_cf_group', [ $this, 'handle_delete_cf_group' ] );
        add_action( 'admin_post_elm_save_visual_promo', [ $this, 'handle_save_visual_promo' ] );

        // Live AJAX endpoints for Signature Verification & Real In-WP Phone Simulator
        add_action( 'wp_ajax_elm_test_signature', [ $this, 'ajax_test_signature' ] );
        add_action( 'wp_ajax_elm_sim_action', [ $this, 'ajax_sim_action' ] );
    }

    private function can_manage(): bool {
        return current_user_can( 'manage_options' ) || current_user_can( 'manage_woocommerce' );
    }

    public function register_menu(): void {
        $cap = current_user_can( 'manage_options' ) ? 'manage_options' : 'manage_woocommerce';

        add_menu_page(
            __( 'Epic License Manager', 'epic-license-manager' ),
            __( 'Epic Licenses', 'epic-license-manager' ),
            $cap,
            'elm-dashboard',
            [ $this, 'render_page' ],
            'dashicons-shield-alt',
            null
        );

        // Register primary submenu first so WP never replaces it with elm_promo CPT!
        add_submenu_page( 'elm-dashboard', __( 'License Reports & XLSX', 'epic-license-manager' ), __( 'گزارش‌ها و اکسل (Reports)', 'epic-license-manager' ), $cap, 'elm-dashboard', [ $this, 'render_page' ] );
        add_submenu_page( 'elm-dashboard', __( 'Apps & Ed25519 Keys', 'epic-license-manager' ), __( 'اپلیکیشن‌ها و کلیدها', 'epic-license-manager' ), $cap, 'elm-apps', [ $this, 'render_page' ] );
        add_submenu_page( 'elm-dashboard', __( 'Custom Fields (ACF-Style)', 'epic-license-manager' ), __( 'فیلدساز سفارشی (ACF)', 'epic-license-manager' ), $cap, 'elm-custom-fields', [ $this, 'render_page' ] );
        add_submenu_page( 'elm-dashboard', __( 'Visual HTML Promos', 'epic-license-manager' ), __( 'تبلیغات HTML بصری', 'epic-license-manager' ), $cap, 'elm-promos', [ $this, 'render_page' ] );
        add_submenu_page( 'elm-dashboard', __( 'Phone Simulator & API', 'epic-license-manager' ), __( 'شبیه‌ساز گوشی و API', 'epic-license-manager' ), $cap, 'elm-simulator', [ $this, 'render_page' ] );
        add_submenu_page( 'elm-dashboard', __( 'Code & SDK Builder', 'epic-license-manager' ), __( 'کدساز SDK و پرامپت AI', 'epic-license-manager' ), $cap, 'elm-sdk-builder', [ $this, 'render_page' ] );
        add_submenu_page( 'elm-dashboard', __( 'Calendars & WooCommerce', 'epic-license-manager' ), __( 'تقویم، ووکامرس و پچ', 'epic-license-manager' ), $cap, 'elm-settings', [ $this, 'render_page' ] );
    }

    public function ensure_menu_order(): void {
        global $submenu;
        if ( empty( $submenu['elm-dashboard'] ) || ! is_array( $submenu['elm-dashboard'] ) ) {
            return;
        }
        $priority_slugs = [
            'elm-dashboard',
            'elm-apps',
            'elm-custom-fields',
            'elm-promos',
            'elm-simulator',
            'elm-sdk-builder',
            'elm-settings',
        ];
        $ordered = [];
        $others  = [];
        foreach ( $priority_slugs as $slug ) {
            foreach ( $submenu['elm-dashboard'] as $item ) {
                if ( ( $item[2] ?? '' ) === $slug ) {
                    $ordered[] = $item;
                }
            }
        }
        foreach ( $submenu['elm-dashboard'] as $item ) {
            if ( ! in_array( $item[2] ?? '', $priority_slugs, true ) ) {
                $others[] = $item;
            }
        }
        $submenu['elm-dashboard'] = array_merge( $ordered, $others );
    }

    public function enqueue_assets( string $hook ): void {
        $page = isset( $_GET['page'] ) ? sanitize_key( (string) wp_unslash( $_GET['page'] ) ) : '';
        if ( ! str_starts_with( $page, 'elm-' ) && ! str_contains( $hook, 'elm-' ) ) {
            return;
        }
        wp_enqueue_style( 'elm-admin', ELM_PLUGIN_URL . 'assets/admin.css', [], ELM_VERSION );
        wp_enqueue_script( 'elm-admin', ELM_PLUGIN_URL . 'assets/admin.js', [], ELM_VERSION, true );
        wp_localize_script( 'elm-admin', 'ELM_ADMIN_CFG', [
            'ajaxUrl'       => admin_url( 'admin-ajax.php' ),
            'nonce'         => wp_create_nonce( 'elm_ajax_nonce' ),
            'homeUrl'       => untrailingslashit( home_url() ),
            'restPrettyUrl' => untrailingslashit( home_url() ) . '/wp-json/elm/v1',
            'restQueryUrl'  => untrailingslashit( home_url() ) . '/?rest_route=/elm/v1',
            'isRtl'         => is_rtl(),
        ] );
    }

    private function is_mu_patch_installed(): bool {
        $mu_dir = defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : ( WP_CONTENT_DIR . '/mu-plugins' );
        return file_exists( trailingslashit( $mu_dir ) . ELM_MU_PATCH_FILENAME );
    }

    public function render_sodium_and_permalink_notice(): void {
        if ( ! $this->can_manage() ) { return; }
        $screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
        if ( ! $screen || ( ! str_contains( $screen->id, 'elm' ) && 'plugins' !== $screen->id ) ) {
            return;
        }
        if ( ! $this->crypto->is_sodium_available() ) {
            echo '<div class="notice notice-error"><p><strong>Epic License Manager:</strong> '
                . esc_html__( 'اکستنشن PHP Sodium (Ed25519) روی سرور غیرفعال است! لطفاً در تنظیمات PHP 8.2 هاست، ext-sodium را فعال کنید.', 'epic-license-manager' )
                . '</p></div>';
        }
    }

    private function page_url( string $tab ): string {
        $map = [
            'reports'       => 'elm-dashboard',
            'apps'          => 'elm-apps',
            'custom_fields' => 'elm-custom-fields',
            'promos'        => 'elm-promos',
            'simulator'     => 'elm-simulator',
            'sdk_builder'   => 'elm-sdk-builder',
            'settings'      => 'elm-settings',
        ];
        $slug = $map[ $tab ] ?? 'elm-dashboard';
        return admin_url( 'admin.php?page=' . $slug );
    }

    public function handle_save_settings(): void {
        if ( ! $this->can_manage() ) { wp_die( 'Unauthorized' ); }
        check_admin_referer( 'elm_save_settings_nonce' );

        update_option( 'elm_calendar_settings', [
            'public' => sanitize_key( (string) wp_unslash( $_POST['cal_public'] ?? 'jalali' ) ),
            'admin'  => sanitize_key( (string) wp_unslash( $_POST['cal_admin'] ?? 'gregorian' ) ),
            'plugin' => sanitize_key( (string) wp_unslash( $_POST['cal_plugin'] ?? 'jalali' ) ),
        ] );

        $statuses = isset( $_POST['wc_trigger_statuses'] ) && is_array( $_POST['wc_trigger_statuses'] )
            ? array_map( 'sanitize_key', wp_unslash( $_POST['wc_trigger_statuses'] ) )
            : [ 'completed' ];

        update_option( 'elm_wc_settings', [
            'trigger_statuses'              => $statuses,
            'conditional_cart_registration' => ! empty( $_POST['wc_conditional_cart_reg'] ),
        ] );

        wp_safe_redirect( add_query_arg( 'saved', '1', $this->page_url( 'settings' ) ) );
        exit;
    }

    public function handle_reinstall_mu_patch(): void {
        if ( ! $this->can_manage() ) { wp_die( 'Unauthorized' ); }
        check_admin_referer( 'elm_reinstall_mu_nonce' );
        $ok = Epic_License_Manager::install_mu_patch();
        wp_safe_redirect( add_query_arg( 'mu_patch', $ok ? '1' : '0', $this->page_url( 'settings' ) ) );
        exit;
    }

    public function handle_save_app(): void {
        if ( ! $this->can_manage() ) { wp_die( 'Unauthorized' ); }
        check_admin_referer( 'elm_save_app_nonce' );

        global $wpdb;
        $table  = $wpdb->prefix . 'elm_apps';
        $app_id = isset( $_POST['app_id'] ) ? absint( $_POST['app_id'] ) : 0;

        $custom_hex  = trim( sanitize_text_field( (string) wp_unslash( $_POST['custom_public_key_hex'] ?? '' ) ) );
        $custom_seed = trim( sanitize_text_field( (string) wp_unslash( $_POST['custom_seed_hex'] ?? '' ) ) );
        $regen_keys  = ! empty( $_POST['regenerate_keys'] );

        $data = [
            'app_slug'           => sanitize_key( (string) wp_unslash( $_POST['app_slug'] ?? '' ) ),
            'app_name'           => sanitize_text_field( (string) wp_unslash( $_POST['app_name'] ?? '' ) ),
            'platform'           => sanitize_key( (string) wp_unslash( $_POST['platform'] ?? 'android' ) ),
            'license_mode'       => sanitize_key( (string) wp_unslash( $_POST['license_mode'] ?? 'method2_trial' ) ),
            'trial_days'         => max( 0, absint( $_POST['trial_days'] ?? 14 ) ),
            'offline_grace_days' => max( 1, absint( $_POST['offline_grace_days'] ?? 14 ) ),
            'purchase_url'       => esc_url_raw( (string) wp_unslash( $_POST['purchase_url'] ?? '' ) ),
            'gated_features'     => sanitize_textarea_field( (string) wp_unslash( $_POST['gated_features'] ?? '' ) ),
            'is_active'          => ! empty( $_POST['is_active'] ) ? 1 : 0,
        ];

        if ( $app_id > 0 ) {
            if ( preg_match( '/^[0-9a-fA-F]{64}$/', $custom_seed ) ) {
                $keys = $this->crypto->generate_app_keypair( $custom_seed );
                $data['public_key']     = $keys['public_key_b64'];
                $data['public_key_hex'] = $keys['public_key_hex'];
                $data['private_key']    = $keys['private_key_b64'];
            } elseif ( preg_match( '/^[0-9a-fA-F]{64}$/', $custom_hex ) ) {
                $data['public_key_hex'] = strtolower( $custom_hex );
                $data['public_key']     = $this->crypto->hex_to_b64( $custom_hex );
            } elseif ( $regen_keys ) {
                $keys = $this->crypto->generate_app_keypair();
                $data['public_key']     = $keys['public_key_b64'];
                $data['public_key_hex'] = $keys['public_key_hex'];
                $data['private_key']    = $keys['private_key_b64'];
            }
            $wpdb->update( $table, $data, [ 'id' => $app_id ] );
        } else {
            $keys = $this->crypto->generate_app_keypair( preg_match( '/^[0-9a-fA-F]{64}$/', $custom_seed ) ? $custom_seed : null );
            if ( preg_match( '/^[0-9a-fA-F]{64}$/', $custom_hex ) && '' === $custom_seed ) {
                $keys['public_key_hex'] = strtolower( $custom_hex );
                $keys['public_key_b64'] = $this->crypto->hex_to_b64( $custom_hex );
            }
            $data['public_key']     = $keys['public_key_b64'];
            $data['public_key_hex'] = $keys['public_key_hex'];
            $data['private_key']    = $keys['private_key_b64'];
            $data['created_at']     = gmdate( 'Y-m-d H:i:s' );
            $wpdb->insert( $table, $data );
        }

        wp_safe_redirect( add_query_arg( 'saved', '1', $this->page_url( 'apps' ) ) );
        exit;
    }

    public function handle_toggle_app(): void {
        if ( ! $this->can_manage() ) { wp_die( 'Unauthorized' ); }
        check_admin_referer( 'elm_toggle_app_nonce' );
        global $wpdb;
        $id     = absint( $_GET['app_id'] ?? 0 );
        $active = absint( $_GET['active'] ?? 1 );
        if ( $id > 0 ) {
            $wpdb->update( $wpdb->prefix . 'elm_apps', [ 'is_active' => $active ? 1 : 0 ], [ 'id' => $id ] );
        }
        wp_safe_redirect( $this->page_url( 'apps' ) );
        exit;
    }

    public function handle_toggle_license(): void {
        if ( ! $this->can_manage() ) { wp_die( 'Unauthorized' ); }
        check_admin_referer( 'elm_toggle_lic_nonce' );
        global $wpdb;
        $id     = absint( $_GET['lic_id'] ?? 0 );
        $status = sanitize_key( (string) wp_unslash( $_GET['next_status'] ?? 'revoked' ) );
        if ( $id > 0 && in_array( $status, [ 'active', 'revoked' ], true ) ) {
            $wpdb->update( $wpdb->prefix . 'elm_licenses', [ 'status' => $status ], [ 'id' => $id ] );
        }
        wp_safe_redirect( $this->page_url( 'reports' ) );
        exit;
    }

    public function handle_save_cf_group(): void {
        if ( ! $this->can_manage() ) { wp_die( 'Unauthorized' ); }
        check_admin_referer( 'elm_save_cf_nonce' );

        $groups   = $this->custom_fields->get_groups();
        $group_id = sanitize_key( (string) wp_unslash( $_POST['group_id'] ?? '' ) ) ?: ( 'grp_' . time() );
        $targets  = isset( $_POST['targets'] ) && is_array( $_POST['targets'] ) ? array_map( 'sanitize_key', wp_unslash( $_POST['targets'] ) ) : [ 'wc_product' ];

        $fields_json = (string) wp_unslash( $_POST['fields_json'] ?? '[]' );
        $conds_json  = (string) wp_unslash( $_POST['conditions_json'] ?? '[]' );
        $fields      = json_decode( $fields_json, true );
        $conditions  = json_decode( $conds_json, true );

        $new_group = [
            'id'                 => $group_id,
            'title'              => sanitize_text_field( (string) wp_unslash( $_POST['group_title'] ?? 'گروه فیلد سفارشی' ) ),
            'targets'            => $targets,
            'autoInjectFrontend' => ! empty( $_POST['auto_inject_frontend'] ),
            'injectHook'         => sanitize_key( (string) wp_unslash( $_POST['inject_hook'] ?? 'the_content_after' ) ),
            'conditions'         => is_array( $conditions ) ? $conditions : [],
            'fields'             => is_array( $fields ) ? $fields : [],
            'active'             => true,
        ];

        $replaced = false;
        foreach ( $groups as $idx => $g ) {
            if ( ( $g['id'] ?? '' ) === $group_id ) {
                $groups[ $idx ] = $new_group;
                $replaced = true;
                break;
            }
        }
        if ( ! $replaced ) {
            $groups[] = $new_group;
        }
        $this->custom_fields->save_groups( $groups );

        wp_safe_redirect( add_query_arg( 'saved', '1', $this->page_url( 'custom_fields' ) ) );
        exit;
    }

    public function handle_delete_cf_group(): void {
        if ( ! $this->can_manage() ) { wp_die( 'Unauthorized' ); }
        check_admin_referer( 'elm_delete_cf_nonce' );
        $gid    = sanitize_key( (string) wp_unslash( $_GET['group_id'] ?? '' ) );
        $groups = array_filter( $this->custom_fields->get_groups(), static fn( $g ) => ( $g['id'] ?? '' ) !== $gid );
        $this->custom_fields->save_groups( $groups );
        wp_safe_redirect( $this->page_url( 'custom_fields' ) );
        exit;
    }

    public function handle_save_visual_promo(): void {
        if ( ! $this->can_manage() ) { wp_die( 'Unauthorized' ); }
        check_admin_referer( 'elm_save_promo_nonce' );

        global $wpdb;
        $app_id   = absint( $_POST['app_id'] ?? 0 );
        $title    = sanitize_text_field( (string) wp_unslash( $_POST['promo_title'] ?? 'پیشنهاد ویژه ارتقا' ) );
        $html     = wp_kses_post( (string) wp_unslash( $_POST['promo_html'] ?? '' ) );
        $cta_url  = esc_url_raw( (string) wp_unslash( $_POST['promo_cta_url'] ?? '' ) );
        $cta_lbl  = sanitize_text_field( (string) wp_unslash( $_POST['promo_cta_label'] ?? 'خرید و دریافت آنی لایسنس' ) );
        $theme    = sanitize_hex_color( (string) wp_unslash( $_POST['promo_theme'] ?? '#0f4c81' ) ) ?: '#0f4c81';
        $mode     = sanitize_key( (string) wp_unslash( $_POST['promo_display_mode'] ?? 'floating_modal' ) );
        $interval = max( 15, absint( $_POST['promo_interval_sec'] ?? 180 ) );
        $enabled  = ! empty( $_POST['promo_enabled'] ) ? 1 : 0;

        $post_id = wp_insert_post( [
            'post_type'    => 'elm_promo',
            'post_title'   => $title,
            'post_content' => $html,
            'post_status'  => 'publish',
        ] );

        if ( $post_id && ! is_wp_error( $post_id ) ) {
            update_post_meta( $post_id, '_elm_promo_cta_url', $cta_url );
            update_post_meta( $post_id, '_elm_promo_cta_label', $cta_lbl );
            update_post_meta( $post_id, '_elm_promo_theme', $theme );
            if ( $app_id > 0 ) {
                $wpdb->update(
                    $wpdb->prefix . 'elm_apps',
                    [
                        'promo_enabled'      => $enabled,
                        'promo_post_id'      => $post_id,
                        'promo_display_mode' => $mode,
                        'promo_interval_sec' => $interval,
                        'promo_html'         => $html,
                        'purchase_url'       => $cta_url ?: '',
                    ],
                    [ 'id' => $app_id ]
                );
            }
        }

        wp_safe_redirect( add_query_arg( 'saved', '1', $this->page_url( 'promos' ) ) );
        exit;
    }

    public function ajax_test_signature(): void {
        check_ajax_referer( 'elm_ajax_nonce', 'nonce' );
        if ( ! $this->can_manage() ) { wp_send_json_error( 'Unauthorized', 403 ); }

        global $wpdb;
        $app_id     = absint( $_POST['app_id'] ?? 0 );
        $client_key = sanitize_text_field( (string) wp_unslash( $_POST['client_public_key'] ?? '' ) );
        $app        = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}elm_apps WHERE id = %d", $app_id ) );
        if ( ! $app ) {
            wp_send_json_error( 'App not found', 404 );
        }

        $sample_payload = [
            'type'            => 'license',
            'app_slug'        => $app->app_slug,
            'server_time_utc' => gmdate( 'c' ),
            'test'            => true,
        ];
        $token      = $this->crypto->sign_token( $sample_payload, (string) $app->private_key );
        $server_hex = $app->public_key_hex ?: $this->crypto->b64_to_hex( (string) $app->public_key );
        $verify_key = '' !== $client_key ? $client_key : $server_hex;
        $check      = $this->crypto->verify_token_with_key( $token, $verify_key );

        wp_send_json_success( [
            'server_hex' => $server_hex,
            'server_b64' => $app->public_key,
            'token'      => $token,
            'verified'   => $check['valid'],
            'error'      => $check['error'],
        ] );
    }

    public function ajax_sim_action(): void {
        check_ajax_referer( 'elm_ajax_nonce', 'nonce' );
        if ( ! $this->can_manage() ) { wp_send_json_error( 'Unauthorized', 403 ); }

        global $wpdb;
        $op       = sanitize_key( (string) wp_unslash( $_POST['op'] ?? '' ) );
        $app_slug = sanitize_key( (string) wp_unslash( $_POST['app_slug'] ?? '' ) );
        $hw_hash  = sanitize_text_field( (string) wp_unslash( $_POST['hardware_hash'] ?? 'wp-admin-sim-device-01' ) );
        $dev_mod  = sanitize_text_field( (string) wp_unslash( $_POST['device_model'] ?? 'Pixel 9 Pro (WP Simulator)' ) );
        $os_ver   = sanitize_text_field( (string) wp_unslash( $_POST['os_version'] ?? 'Android 15' ) );

        if ( 'clear_sandbox' === $op ) {
            $wpdb->delete( $wpdb->prefix . 'elm_activations', [ 'is_test_sandbox' => 1 ] );
            $wpdb->delete( $wpdb->prefix . 'elm_licenses', [ 'is_test_sandbox' => 1 ] );
            wp_send_json_success( [ 'message' => __( 'تمام رکوردهای آزمایشی شبیه‌ساز با موفقیت پاک‌سازی شدند.', 'epic-license-manager' ) ] );
        }

        if ( 'create_sandbox_license' === $op ) {
            $app = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}elm_apps WHERE app_slug = %s", $app_slug ) );
            if ( ! $app ) {
                wp_send_json_error( 'App not found', 404 );
            }
            $key = $this->crypto->generate_license_key( 'ELMTEST' );
            $wpdb->insert( $wpdb->prefix . 'elm_licenses', [
                'license_key'     => $key,
                'app_id'          => (int) $app->id,
                'order_id'        => 0,
                'user_id'         => get_current_user_id(),
                'customer_name'   => 'Test Sandbox User',
                'customer_mobile' => '09120000000',
                'customer_email'  => 'sandbox@' . wp_parse_url( home_url(), PHP_URL_HOST ),
                'product_title'   => 'Sandbox Test License (1 Month)',
                'payment_method'  => 'WP Simulator',
                'order_total'     => 0,
                'duration_type'   => '1m',
                'status'          => 'active',
                'is_test_sandbox' => 1,
                'issued_at'       => gmdate( 'Y-m-d H:i:s' ),
            ] );
            wp_send_json_success( [ 'status' => 200, 'data' => [ 'ok' => true, 'license_key' => $key, 'is_test_sandbox' => 1 ] ] );
        }

        $endpoint = match ( $op ) {
            'trial'    => '/elm/v1/trial/activate',
            'activate' => '/elm/v1/license/activate',
            'verify'   => '/elm/v1/license/verify',
            'promo'    => '/elm/v1/promo',
            default    => '/elm/v1/app/handshake',
        };
        $method = ( 'promo' === $op ) ? 'GET' : 'POST';
        $req    = new \\WP_REST_Request( $method, $endpoint );
        $req->set_param( 'app_slug', $app_slug );
        $req->set_param( 'hardware_hash', $hw_hash );
        $req->set_param( 'device_model', $dev_mod );
        $req->set_param( 'os_version', $os_ver );
        $req->set_param( 'is_test_sandbox', 1 );
        if ( 'activate' === $op || 'verify' === $op ) {
            $req->set_param( 'license_key', sanitize_text_field( (string) wp_unslash( $_POST['license_key'] ?? '' ) ) );
        }

        $resp = rest_do_request( $req );
        wp_send_json_success( [
            'status' => $resp->get_status(),
            'data'   => $resp->get_data(),
        ] );
    }

    private function resolve_active_tab(): string {
        $page = isset( $_GET['page'] ) ? sanitize_key( (string) wp_unslash( $_GET['page'] ) ) : 'elm-dashboard';
        $tab  = isset( $_GET['tab'] ) ? sanitize_key( (string) wp_unslash( $_GET['tab'] ) ) : '';
        if ( '' !== $tab ) {
            return $tab;
        }
        return match ( $page ) {
            'elm-apps'          => 'apps',
            'elm-custom-fields' => 'custom_fields',
            'elm-promos'        => 'promos',
            'elm-simulator'     => 'simulator',
            'elm-sdk-builder'   => 'sdk_builder',
            'elm-settings'      => 'settings',
            default             => 'reports',
        };
    }

    public function render_page(): void {
        $tab  = $this->resolve_active_tab();
        $tabs = [
            'reports'       => __( 'گزارش‌ها و اکسل واقعی', 'epic-license-manager' ),
            'apps'          => __( 'اپلیکیشن‌ها و کلید Ed25519', 'epic-license-manager' ),
            'custom_fields' => __( 'فیلدساز شرطی (ACF)', 'epic-license-manager' ),
            'promos'        => __( 'تبلیغات HTML و CPT', 'epic-license-manager' ),
            'simulator'     => __( 'شبیه‌ساز گوشی و API', 'epic-license-manager' ),
            'sdk_builder'   => __( 'کدساز SDK و پرامپت AI', 'epic-license-manager' ),
            'settings'      => __( 'تقویم، ووکامرس و پچ', 'epic-license-manager' ),
        ];

        $mu_ok = $this->is_mu_patch_installed();
        echo '<div class="wrap elm-studio-wrap">';
        echo '<div class="elm-studio-header">';
        echo '<div><h1>' . esc_html__( 'Epic License Manager v2 — استودیوی مدیریت لایسنس', 'epic-license-manager' ) . '</h1>';
        echo '<p>' . esc_html( home_url() ) . ' · <code>/wp-json/elm/v1</code> · <code>/?rest_route=/elm/v1</code></p></div>';
        echo '<div class="elm-header-badges">';
        echo '<span class="elm-pill ' . ( $this->crypto->is_sodium_available() ? 'ok' : 'err' ) . '">'
            . ( $this->crypto->is_sodium_available() ? 'Ed25519 Sodium فعال' : 'خطا: Sodium غیرفعال' ) . '</span>';
        echo '<span class="elm-pill ' . ( $mu_ok ? 'ok' : 'warn' ) . '">'
            . ( $mu_ok ? 'پچ MU-Plugin فعال' : 'MU-Plugin نصب نشده' ) . '</span>';
        echo '</div></div>';

        if ( ! empty( $_GET['saved'] ) ) {
            echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__( 'تغییرات با موفقیت ذخیره شد.', 'epic-license-manager' ) . '</p></div>';
        }

        echo '<nav class="elm-studio-tabs">';
        foreach ( $tabs as $k => $label ) {
            $cls = ( $k === $tab ) ? 'elm-tab active' : 'elm-tab';
            echo '<a href="' . esc_url( $this->page_url( $k ) ) . '" class="' . esc_attr( $cls ) . '">' . esc_html( $label ) . '</a>';
        }
        echo '<a href="' . esc_url( admin_url( 'edit.php?post_type=elm_promo' ) ) . '" class="elm-tab">' . esc_html__( 'آرشیو پست‌تایپ تبلیغات', 'epic-license-manager' ) . '</a>';
        echo '</nav>';

        match ( $tab ) {
            'apps'          => $this->render_apps_tab(),
            'custom_fields' => $this->render_custom_fields_tab(),
            'promos'        => $this->render_promos_tab(),
            'simulator'     => $this->render_simulator_tab(),
            'sdk_builder'   => $this->render_sdk_builder_tab(),
            'settings'      => $this->render_settings_tab(),
            default         => $this->render_reports_tab(),
        };
        echo '</div>';
    }

    private function render_reports_tab(): void {
        global $wpdb;
        $stats         = $this->reports->get_summary_stats();
        $extra_defs    = $this->reports->get_available_extra_columns();
        $selected_cols = isset( $_GET['extra_columns'] ) && is_array( $_GET['extra_columns'] ) ? array_map( 'sanitize_key', wp_unslash( $_GET['extra_columns'] ) ) : [];
        $include_sb    = ! empty( $_GET['include_sandbox'] );
        $filters       = [
            'app_id'          => isset( $_GET['app_id'] ) ? absint( $_GET['app_id'] ) : 0,
            'status'          => isset( $_GET['status'] ) ? sanitize_key( (string) wp_unslash( $_GET['status'] ) ) : '',
            'duration'        => isset( $_GET['duration'] ) ? sanitize_key( (string) wp_unslash( $_GET['duration'] ) ) : '',
            'date_from'       => isset( $_GET['date_from'] ) ? sanitize_text_field( (string) wp_unslash( $_GET['date_from'] ) ) : '',
            'date_to'         => isset( $_GET['date_to'] ) ? sanitize_text_field( (string) wp_unslash( $_GET['date_to'] ) ) : '',
            'search'          => isset( $_GET['search'] ) ? sanitize_text_field( (string) wp_unslash( $_GET['search'] ) ) : '',
            'include_sandbox' => $include_sb ? 1 : 0,
            'extra_columns'   => $selected_cols,
        ];
        $rows   = $this->reports->query_licenses( $filters );
        $trials = $this->reports->query_trials( true );
        $apps   = $wpdb->get_results( "SELECT id, app_name FROM {$wpdb->prefix}elm_apps ORDER BY app_name ASC" );

        $export_base = array_merge( $filters, [ 'action' => 'elm_export_report' ] );
        $xlsx_url    = wp_nonce_url( add_query_arg( array_merge( $export_base, [ 'format' => 'xlsx' ] ), admin_url( 'admin-post.php' ) ), 'elm_export_report_nonce' );
        $csv_url     = wp_nonce_url( add_query_arg( array_merge( $export_base, [ 'format' => 'csv' ] ), admin_url( 'admin-post.php' ) ), 'elm_export_report_nonce' );
        ?>
        <div class="elm-kpi-grid">
            <div class="elm-kpi-card"><span><?php esc_html_e( 'کل درآمد فروش لایسنس', 'epic-license-manager' ); ?></span><strong><?php echo esc_html( number_format( $stats['total_revenue'] ) ); ?></strong></div>
            <div class="elm-kpi-card"><span><?php esc_html_e( 'لایسنس‌های فعال', 'epic-license-manager' ); ?></span><strong><?php echo esc_html( (string) $stats['active_licenses'] ); ?></strong></div>
            <div class="elm-kpi-card"><span><?php esc_html_e( 'لایسنس‌های منقضی', 'epic-license-manager' ); ?></span><strong><?php echo esc_html( (string) $stats['expired_licenses'] ); ?></strong></div>
            <div class="elm-kpi-card"><span><?php esc_html_e( 'دوره‌های آزمایشی فعال', 'epic-license-manager' ); ?></span><strong><?php echo esc_html( (string) $stats['active_trials'] ); ?></strong></div>
            <div class="elm-kpi-card"><span><?php esc_html_e( 'رکوردهای تست شبیه‌ساز', 'epic-license-manager' ); ?></span><strong><?php echo esc_html( (string) $stats['sandbox_records'] ); ?></strong></div>
        </div>

        <div class="elm-card">
            <h2><?php esc_html_e( 'گزارش جامع لایسنس‌ها، دستگاه‌ها و خروجی واقعی اکسل فارسی', 'epic-license-manager' ); ?></h2>
            <form method="get" class="elm-filter-bar">
                <input type="hidden" name="page" value="elm-dashboard" />
                <input type="hidden" name="tab" value="reports" />
                <input type="text" name="search" value="<?php echo esc_attr( $filters['search'] ); ?>" placeholder="جستجو: کلید، نام، موبایل، ایمیل، هش..." />
                <select name="app_id">
                    <option value="0">همه اپلیکیشن‌ها</option>
                    <?php if ( is_array( $apps ) ) : foreach ( $apps as $a ) : ?>
                        <option value="<?php echo esc_attr( (string) $a->id ); ?>" <?php selected( $filters['app_id'], (int) $a->id ); ?>><?php echo esc_html( (string) $a->app_name ); ?></option>
                    <?php endforeach; endif; ?>
                </select>
                <select name="status">
                    <option value="">همه وضعیت‌ها</option>
                    <option value="active" <?php selected( $filters['status'], 'active' ); ?>>فعال</option>
                    <option value="expired" <?php selected( $filters['status'], 'expired' ); ?>>منقضی</option>
                    <option value="revoked" <?php selected( $filters['status'], 'revoked' ); ?>>لغو شده</option>
                </select>
                <select name="duration">
                    <option value="">همه پلن‌ها</option>
                    <option value="1m" <?php selected( $filters['duration'], '1m' ); ?>>۱ ماهه</option>
                    <option value="3m" <?php selected( $filters['duration'], '3m' ); ?>>۳ ماهه</option>
                    <option value="1y" <?php selected( $filters['duration'], '1y' ); ?>>۱ ساله</option>
                    <option value="lifetime" <?php selected( $filters['duration'], 'lifetime' ); ?>>دائمی</option>
                </select>
                <input type="date" name="date_from" value="<?php echo esc_attr( $filters['date_from'] ); ?>" title="از تاریخ" />
                <input type="date" name="date_to" value="<?php echo esc_attr( $filters['date_to'] ); ?>" title="تا تاریخ" />
                <label class="elm-inline-chk"><input type="checkbox" name="include_sandbox" value="1" <?php checked( $include_sb ); ?> /> نمایش رکوردهای سندباکس</label>
                <button type="submit" class="button">اعمال فیلتر</button>
                <a href="<?php echo esc_url( $xlsx_url ); ?>" class="button button-primary">دانلود اکسل واقعی (.XLSX)</a>
                <a href="<?php echo esc_url( $csv_url ); ?>" class="button">دانلود CSV فارسی (BOM ;)</a>

                <?php if ( ! empty( $extra_defs ) ) : ?>
                <div class="elm-extra-cols-bar">
                    <strong>ستون‌های انتخابی جدول و اکسل:</strong>
                    <?php foreach ( $extra_defs as $ck => $cdef ) : ?>
                        <label class="elm-inline-chk">
                            <input type="checkbox" name="extra_columns[]" value="<?php echo esc_attr( $ck ); ?>" <?php checked( in_array( $ck, $selected_cols, true ) ); ?> />
                            <?php echo esc_html( $cdef['label'] ); ?>
                        </label>
                    <?php endforeach; ?>
                </div>
                <?php endif; ?>
            </form>

            <div class="elm-table-scroll">
                <table class="widefat striped">
                    <thead><tr>
                        <th>کلید لایسنس</th><th>اپلیکیشن</th><th>سفارش / درگاه / مبلغ</th><th>مشتری / موبایل / ایمیل</th><th>دستگاه / سیستم‌عامل</th><th>هش سخت‌افزار</th><th>صدور / انقضا</th><th>باقی‌مانده / نصب مجدد</th><th>وضعیت و عملیات</th>
                        <?php foreach ( $selected_cols as $sc ) : ?>
                            <th><?php echo esc_html( $extra_defs[ $sc ]['label'] ?? $sc ); ?></th>
                        <?php endforeach; ?>
                    </tr></thead>
                    <tbody>
                    <?php if ( empty( $rows ) ) : ?>
                        <tr><td colspan="12">هیچ لایسنسی مطابق فیلتر فعلی ثبت نشده است. می‌توانید در تب شبیه‌ساز گوشی یک لایسنس تست بسازید یا از طریق ووکامرس سفارش تکمیل کنید.</td></tr>
                    <?php else : foreach ( $rows as $r ) :
                        $next_st = ( 'active' === $r['status'] ) ? 'revoked' : 'active';
                        $tog_url = wp_nonce_url( add_query_arg( [ 'action' => 'elm_toggle_license', 'lic_id' => $r['id'], 'next_status' => $next_st ], admin_url( 'admin-post.php' ) ), 'elm_toggle_lic_nonce' );
                        ?>
                        <tr>
                            <td><code><?php echo esc_html( (string) $r['license_key'] ); ?></code><?php if ( ! empty( $r['is_test_sandbox'] ) ) echo ' <span class="elm-badge warn">Sandbox</span>'; ?></td>
                            <td><?php echo esc_html( (string) $r['app_name'] . ' (' . (string) $r['duration'] . ')' ); ?></td>
                            <td>#<?php echo esc_html( (string) $r['order_id'] ); ?> · <?php echo esc_html( (string) $r['payment_method'] ); ?><br><small><?php echo esc_html( (string) $r['order_total'] ); ?></small></td>
                            <td><?php echo esc_html( (string) $r['customer_name'] ); ?><br><small><?php echo esc_html( (string) $r['customer_mobile'] . ' · ' . (string) $r['customer_email'] ); ?></small></td>
                            <td><?php echo esc_html( (string) $r['device_model'] . ' / ' . (string) $r['os_version'] ); ?></td>
                            <td><code><?php echo esc_html( substr( (string) $r['hardware_hash'], 0, 14 ) ); ?></code></td>
                            <td><small>صدور: <?php echo esc_html( (string) $r['issued_at'] ); ?><br>انقضا: <?php echo esc_html( (string) $r['expires_at'] ); ?></small></td>
                            <td><?php echo esc_html( (string) $r['remaining'] ); ?><br><small>نصب مجدد: <?php echo esc_html( (string) $r['reinstall_attempts'] ); ?> · خطا: <?php echo esc_html( (string) $r['last_error_code'] ); ?></small></td>
                            <td>
                                <span class="elm-badge <?php echo 'active' === $r['status'] ? 'ok' : 'err'; ?>"><?php echo esc_html( (string) $r['status'] ); ?></span><br>
                                <a href="<?php echo esc_url( $tog_url ); ?>" class="button button-small" style="margin-top:4px;"><?php echo 'active' === $r['status'] ? 'لغو' : 'فعال‌سازی'; ?></a>
                            </td>
                            <?php foreach ( $selected_cols as $sc ) : ?>
                                <td><?php echo esc_html( (string) ( $r[ $sc ] ?? '—' ) ); ?></td>
                            <?php endforeach; ?>
                        </tr>
                    <?php endforeach; endif; ?>
                    </tbody>
                </table>
            </div>
        </div>

        <div class="elm-card">
            <h3><?php esc_html_e( 'گزارش دوره‌های آزمایشی (Trial) و تلاش‌های نصب مجدد روی دستگاه‌ها', 'epic-license-manager' ); ?></h3>
            <div class="elm-table-scroll">
                <table class="widefat striped">
                    <thead><tr><th>اپلیکیشن</th><th>دستگاه / OS</th><th>هش سخت‌افزار</th><th>شروع Trial</th><th>انقضا</th><th>باقی‌مانده</th><th>تلاش نصب مجدد</th><th>آخرین خطا</th></tr></thead>
                    <tbody>
                    <?php if ( empty( $trials ) ) : ?>
                        <tr><td colspan="8">هنوز هیچ دستگاهی دوره آزمایشی ثبت نکرده است.</td></tr>
                    <?php else : foreach ( $trials as $tr ) : ?>
                        <tr>
                            <td><?php echo esc_html( $tr['app_name'] ); ?> <?php if ( ! empty( $tr['is_test_sandbox'] ) ) echo '<span class="elm-badge warn">Sandbox</span>'; ?></td>
                            <td><?php echo esc_html( $tr['device_model'] . ' / ' . $tr['os_version'] ); ?></td>
                            <td><code><?php echo esc_html( substr( $tr['hardware_hash'], 0, 18 ) ); ?></code></td>
                            <td><?php echo esc_html( $tr['trial_started_at'] ); ?></td>
                            <td><?php echo esc_html( $tr['trial_expires_at'] ); ?></td>
                            <td><?php echo esc_html( $tr['remaining'] ); ?></td>
                            <td><?php echo esc_html( (string) $tr['reinstall_attempts'] ); ?></td>
                            <td><code><?php echo esc_html( $tr['last_error_code'] ); ?></code></td>
                        </tr>
                    <?php endforeach; endif; ?>
                    </tbody>
                </table>
            </div>
        </div>
        <?php
    }

    private function render_apps_tab(): void {
        global $wpdb;
        $apps    = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}elm_apps ORDER BY id DESC" );
        $edit_id = isset( $_GET['edit_app'] ) ? absint( $_GET['edit_app'] ) : 0;
        $editing = $edit_id > 0 ? $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}elm_apps WHERE id = %d", $edit_id ) ) : null;
        ?>
        <div class="elm-card">
            <div class="elm-card-head">
                <h2><?php echo $editing ? esc_html__( 'ویرایش کامل اپلیکیشن و همسان‌سازی کلید Ed25519', 'epic-license-manager' ) : esc_html__( 'ثبت اپلیکیشن جدید یا ایمپورت elm-manifest.json', 'epic-license-manager' ); ?></h2>
                <button type="button" id="elm-toggle-manifest-import" class="button"><?php esc_html_e( 'ایمپورت از elm-manifest.json', 'epic-license-manager' ); ?></button>
            </div>

            <div id="elm-manifest-import-box" class="elm-subpanel" style="display:none;">
                <p><strong><?php esc_html_e( 'محتوای JSON فایل elm-manifest.json را جایگذاری یا آپلود کنید تا فرم زیر خودکار پر شود:', 'epic-license-manager' ); ?></strong></p>
                <input type="file" id="elm-manifest-file-input" accept=".json,application/json" style="margin-bottom:8px;" />
                <textarea id="elm-manifest-json-text" rows="4" class="large-text code" placeholder='{"app_name":"My App","app_slug":"my-app","platform":"android","license_mode":"method2_trial","trial_days":14}'></textarea>
                <button type="button" id="elm-apply-manifest-btn" class="button button-primary" style="margin-top:8px;">اعمال در فرم</button>
            </div>

            <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="elm-form-grid">
                <?php wp_nonce_field( 'elm_save_app_nonce' ); ?>
                <input type="hidden" name="action" value="elm_save_app" />
                <input type="hidden" name="app_id" value="<?php echo esc_attr( (string) ( $editing->id ?? 0 ) ); ?>" />
                <label>نام اپلیکیشن <input type="text" id="elm-app-name" name="app_name" required value="<?php echo esc_attr( (string) ( $editing->app_name ?? '' ) ); ?>" /></label>
                <label>شناسه یکتا (App Slug) <input type="text" id="elm-app-slug" name="app_slug" required value="<?php echo esc_attr( (string) ( $editing->app_slug ?? '' ) ); ?>" /></label>
                <label>پلتفرم <select id="elm-app-platform" name="platform">
                    <option value="android" <?php selected( $editing->platform ?? 'android', 'android' ); ?>>Android (Kotlin / Gradle)</option>
                    <option value="web" <?php selected( $editing->platform ?? '', 'web' ); ?>>Web (React / Node.js)</option>
                    <option value="cross_platform" <?php selected( $editing->platform ?? '', 'cross_platform' ); ?>>مشترک (Android + Web)</option>
                </select></label>
                <label>مدل لایسنس <select id="elm-app-mode" name="license_mode">
                    <option value="method1_gated" <?php selected( $editing->license_mode ?? '', 'method1_gated' ); ?>>روش ۱: قفل قابلیت‌های ویژه</option>
                    <option value="method2_trial" <?php selected( $editing->license_mode ?? 'method2_trial', 'method2_trial' ); ?>>روش ۲: دوره آزمایشی + قفل قابلیت</option>
                </select></label>
                <label>روزهای آزمایشی (Trial Days) <input type="number" id="elm-app-trial" name="trial_days" value="<?php echo esc_attr( (string) ( $editing->trial_days ?? 14 ) ); ?>" /></label>
                <label>مهلت آفلاین (Offline Grace Days) <input type="number" id="elm-app-grace" name="offline_grace_days" value="<?php echo esc_attr( (string) ( $editing->offline_grace_days ?? 14 ) ); ?>" /></label>
                <label>لینک صفحه خرید محصول <input type="url" id="elm-app-url" name="purchase_url" value="<?php echo esc_attr( (string) ( $editing->purchase_url ?? home_url( '/shop' ) ) ); ?>" /></label>
                <label class="elm-inline-chk" style="align-self:end;"><input type="checkbox" name="is_active" value="1" <?php checked( (int) ( $editing->is_active ?? 1 ), 1 ); ?> /> اپلیکیشن فعال باشد</label>
                <label class="elm-full">قابلیت‌های قفل‌شده (با ویرگول جدا کنید) <input type="text" id="elm-app-gated" name="gated_features" value="<?php echo esc_attr( (string) ( $editing->gated_features ?? '' ) ); ?>" /></label>
                <label class="elm-full">اختیاری: Seed قطعی ۶۴ کاراکتری Hex (ساخت جفت‌کلید عمومی+خصوصی جدید منطبق) <input type="text" name="custom_seed_hex" placeholder="64 hex chars (optional)" class="code" /></label>
                <label class="elm-full">اختیاری: ویرایش مستقیم کلید عمومی Hex ۶۴ کاراکتری <input type="text" name="custom_public_key_hex" value="<?php echo esc_attr( (string) ( $editing->public_key_hex ?? '' ) ); ?>" class="code" /></label>
                <?php if ( $editing ) : ?>
                    <label class="elm-full elm-inline-chk"><input type="checkbox" name="regenerate_keys" value="1" /> ساخت جفت‌کلید تصادفی جدید Ed25519 هنگام ذخیره</label>
                <?php endif; ?>
                <div class="elm-full">
                    <button type="submit" class="button button-primary"><?php echo $editing ? esc_html__( 'ذخیره ویرایش اپلیکیشن', 'epic-license-manager' ) : esc_html__( 'ثبت اپلیکیشن و تولید کلید Ed25519', 'epic-license-manager' ); ?></button>
                    <?php if ( $editing ) : ?>
                        <a href="<?php echo esc_url( $this->page_url( 'apps' ) ); ?>" class="button">انصراف</a>
                    <?php endif; ?>
                </div>
            </form>
        </div>

        <div class="elm-card">
            <h2><?php esc_html_e( 'اپلیکیشن‌های ثبت‌شده و مدیریت کلیدهای عمومی', 'epic-license-manager' ); ?></h2>
            <table class="widefat striped">
                <thead><tr><th>Slug</th><th>نام اپلیکیشن</th><th>مدل</th><th>کلید عمومی Hex (۶۴ کاراکتر برای کاتلین)</th><th>عملیات</th></tr></thead>
                <tbody>
                <?php if ( empty( $apps ) ) : ?>
                    <tr><td colspan="5">هنوز اپلیکیشنی ثبت نشده است. از فرم بالا اولین اپلیکیشن خود را بسازید.</td></tr>
                <?php else : foreach ( $apps as $app ) :
                    $hex = $app->public_key_hex ?: $this->crypto->b64_to_hex( (string) $app->public_key );
                    $manifest_obj = [
                        'app_name'           => $app->app_name,
                        'app_slug'           => $app->app_slug,
                        'platform'           => $app->platform,
                        'license_mode'       => $app->license_mode,
                        'trial_days'         => (int) $app->trial_days,
                        'offline_grace_days' => (int) $app->offline_grace_days,
                        'public_key_hex'     => $hex,
                        'public_key_b64'     => $app->public_key,
                        'purchase_url'       => $app->purchase_url,
                        'gated_features'     => array_values( array_filter( array_map( 'trim', explode( ',', (string) $app->gated_features ) ) ) ),
                        'api_base'           => untrailingslashit( home_url() ) . '/wp-json/elm/v1',
                        'fallback_base'      => untrailingslashit( home_url() ) . '/?rest_route=/elm/v1',
                    ];
                    ?>
                    <tr>
                        <td><code><?php echo esc_html( (string) $app->app_slug ); ?></code></td>
                        <td><?php echo esc_html( (string) $app->app_name ); ?> <?php echo empty( $app->is_active ) ? '<span class="elm-badge warn">متوقف</span>' : '<span class="elm-badge ok">فعال</span>'; ?></td>
                        <td><?php echo esc_html( (string) $app->license_mode ); ?></td>
                        <td><code style="word-break:break-all;font-size:11px;"><?php echo esc_html( $hex ); ?></code></td>
                        <td style="white-space:nowrap;">
                            <a href="<?php echo esc_url( add_query_arg( 'edit_app', (int) $app->id, $this->page_url( 'apps' ) ) ); ?>" class="button button-small">ویرایش</a>
                            <button type="button" class="button button-small elm-open-key-modal" data-app-id="<?php echo esc_attr( (string) $app->id ); ?>" data-hex="<?php echo esc_attr( $hex ); ?>" data-b64="<?php echo esc_attr( (string) $app->public_key ); ?>">کلیدها و تست امضا</button>
                            <button type="button" class="button button-small elm-dl-manifest" data-slug="<?php echo esc_attr( (string) $app->app_slug ); ?>" data-manifest="<?php echo esc_attr( (string) wp_json_encode( $manifest_obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT ) ); ?>">Manifest</button>
                            <a href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=elm_toggle_app&app_id=' . (int) $app->id . '&active=' . ( empty( $app->is_active ) ? '1' : '0' ) ), 'elm_toggle_app_nonce' ) ); ?>" class="button button-small"><?php echo empty( $app->is_active ) ? 'فعال‌سازی' : 'توقف'; ?></a>
                        </td>
                    </tr>
                <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
        <div id="elm-key-modal" class="elm-modal" style="display:none;"></div>
        <?php
    }

    private function render_custom_fields_tab(): void {
        $groups     = $this->custom_fields->get_groups();
        $edit_gid   = isset( $_GET['edit_group'] ) ? sanitize_key( (string) wp_unslash( $_GET['edit_group'] ) ) : '';
        $editing_gr = null;
        foreach ( $groups as $g ) {
            if ( ( $g['id'] ?? '' ) === $edit_gid ) {
                $editing_gr = $g;
                break;
            }
        }
        $init_fields = is_array( $editing_gr['fields'] ?? null ) ? $editing_gr['fields'] : [
            [ 'name' => 'hardware_note', 'label' => 'توضیح سخت‌افزار / دستگاه', 'type' => 'text', 'choices' => [], 'defaultValue' => '', 'showInReport' => true ],
        ];
        $init_conds = is_array( $editing_gr['conditions'] ?? null ) ? $editing_gr['conditions'] : [
            [ 'param' => 'user_logged_in', 'operator' => 'equals', 'value' => 'yes' ],
        ];
        $edit_targets = is_array( $editing_gr['targets'] ?? null ) ? $editing_gr['targets'] : [ 'wc_product' ];
        ?>
        <div class="elm-card">
            <h2><?php echo $editing_gr ? esc_html__( 'ویرایش گروه فیلد سفارشی', 'epic-license-manager' ) : esc_html__( 'فیلدساز سفارشی شرطی (مشابه ACF + متادیتای استاندارد وردپرس و HPOS)', 'epic-license-manager' ); ?></h2>
            <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" id="elm-cf-builder-form" class="elm-form-grid">
                <?php wp_nonce_field( 'elm_save_cf_nonce' ); ?>
                <input type="hidden" name="action" value="elm_save_cf_group" />
                <input type="hidden" name="group_id" value="<?php echo esc_attr( (string) ( $editing_gr['id'] ?? '' ) ); ?>" />
                <input type="hidden" name="fields_json" id="elm-cf-fields-json" value="<?php echo esc_attr( (string) wp_json_encode( $init_fields, JSON_UNESCAPED_UNICODE ) ); ?>" />
                <input type="hidden" name="conditions_json" id="elm-cf-conds-json" value="<?php echo esc_attr( (string) wp_json_encode( $init_conds, JSON_UNESCAPED_UNICODE ) ); ?>" />

                <label>عنوان گروه فیلد <input type="text" name="group_title" required value="<?php echo esc_attr( (string) ( $editing_gr['title'] ?? 'مشخصات لایسنس و محصول' ) ); ?>" /></label>
                <label>محل تزریق خودکار در قالب (بدون نیاز به شورت‌کد) <select name="inject_hook">
                    <?php
                    $hooks = [
                        'the_content_after'         => 'انتهای محتوای نوشته / برگه (the_content)',
                        'wc_single_product_summary' => 'خلاصه صفحه محصول ووکامرس (woocommerce_single_product_summary)',
                        'wc_before_add_to_cart'     => 'پیش از دکمه افزودن به سبد خرید (woocommerce_before_add_to_cart_button)',
                        'wc_account_dashboard'      => 'پیشخوان حساب کاربری ووکامرس (woocommerce_account_dashboard)',
                    ];
                    foreach ( $hooks as $hk => $hl ) : ?>
                        <option value="<?php echo esc_attr( $hk ); ?>" <?php selected( (string) ( $editing_gr['injectHook'] ?? 'the_content_after' ), $hk ); ?>><?php echo esc_html( $hl ); ?></option>
                    <?php endforeach; ?>
                </select></label>

                <div class="elm-full elm-subpanel">
                    <strong>محل‌های اتصال در وردپرس و ووکامرس:</strong><br>
                    <?php foreach ( [ 'wc_product' => 'محصول ساده ووکامرس', 'wc_variation' => 'متغیرهای محصول (Variations)', 'wp_user' => 'پروفایل کاربر و مشتری', 'wp_post' => 'نوشته‌ها (Posts)', 'wp_page' => 'برگه‌ها (Pages)', 'wc_order' => 'سفارش ووکامرس (HPOS)' ] as $tk => $tv ) : ?>
                        <label class="elm-inline-chk" style="margin:6px 12px 0 0;">
                            <input type="checkbox" name="targets[]" value="<?php echo esc_attr( $tk ); ?>" <?php checked( in_array( $tk, $edit_targets, true ) ); ?> /> <?php echo esc_html( $tv ); ?>
                        </label>
                    <?php endforeach; ?>
                    <br>
                    <label class="elm-inline-chk" style="margin-top:8px;">
                        <input type="checkbox" name="auto_inject_frontend" value="1" <?php checked( ! empty( $editing_gr ? ( $editing_gr['autoInjectFrontend'] ?? false ) : true ) ); ?> />
                        تزریق خودکار در فرانت‌اند قالب هنگام برقراری شروط زیر
                    </label>
                </div>

                <div class="elm-full elm-subpanel">
                    <div class="elm-card-head">
                        <strong>فیلدهای داخل گروه</strong>
                        <button type="button" id="elm-cf-add-field" class="button button-small">+ افزودن فیلد جدید</button>
                    </div>
                    <div id="elm-cf-fields-list"></div>
                </div>

                <div class="elm-full elm-subpanel">
                    <div class="elm-card-head">
                        <strong>قوانین شرطی نمایش در بک‌اند و فرانت‌اند</strong>
                        <button type="button" id="elm-cf-add-cond" class="button button-small">+ افزودن شرط جدید</button>
                    </div>
                    <div id="elm-cf-conds-list"></div>
                </div>

                <div class="elm-full">
                    <button type="submit" class="button button-primary">ذخیره گروه فیلد سفارشی</button>
                    <?php if ( $editing_gr ) : ?>
                        <a href="<?php echo esc_url( $this->page_url( 'custom_fields' ) ); ?>" class="button">ساخت گروه جدید</a>
                    <?php endif; ?>
                </div>
            </form>
        </div>

        <div class="elm-card">
            <h3><?php esc_html_e( 'گروه‌های فیلد تعریف‌شده و کد استاندارد توسعه‌دهندگان', 'epic-license-manager' ); ?></h3>
            <?php if ( empty( $groups ) ) : ?>
                <p>هنوز گروه فیلدی ثبت نشده است.</p>
            <?php else : foreach ( $groups as $g ) :
                $first_field = sanitize_key( (string) ( $g['fields'][0]['name'] ?? 'field_name' ) );
                ?>
                <div class="elm-group-row">
                    <div>
                        <strong><?php echo esc_html( (string) ( $g['title'] ?? '' ) ); ?></strong>
                        <div class="elm-muted">اتصال: <?php echo esc_html( implode( '، ', (array) ( $g['targets'] ?? [] ) ) ); ?> · تعداد فیلد: <?php echo esc_html( (string) count( (array) ( $g['fields'] ?? [] ) ) ); ?></div>
                        <code>[elm_field name="<?php echo esc_html( $first_field ); ?>"]</code> ·
                        <code>&lt;?php elm_the_field('<?php echo esc_html( $first_field ); ?>'); ?&gt;</code> ·
                        <code>get_post_meta( get_the_ID(), '<?php echo esc_html( $first_field ); ?>', true )</code>
                    </div>
                    <div style="white-space:nowrap;">
                        <a href="<?php echo esc_url( add_query_arg( 'edit_group', (string) $g['id'], $this->page_url( 'custom_fields' ) ) ); ?>" class="button button-small">ویرایش</a>
                        <a href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=elm_delete_cf_group&group_id=' . (string) $g['id'] ), 'elm_delete_cf_nonce' ) ); ?>" class="button button-small">حذف</a>
                    </div>
                </div>
            <?php endforeach; endif; ?>
        </div>
        <?php
    }

    private function render_promos_tab(): void {
        global $wpdb;
        $apps     = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}elm_apps ORDER BY id DESC" );
        $products = function_exists( 'wc_get_products' ) ? wc_get_products( [ 'limit' => 30, 'status' => 'publish' ] ) : [];
        $wc_items = [];
        foreach ( $products as $p ) {
            if ( $p->is_type( 'variable' ) && method_exists( $p, 'get_children' ) ) {
                foreach ( $p->get_children() as $vid ) {
                    $v = wc_get_product( $vid );
                    if ( $v ) {
                        $wc_items[] = [
                            'id'    => $v->get_id(),
                            'title' => $p->get_name() . ' — ' . wp_strip_all_tags( $v->get_attribute_summary() ?: $v->get_name() ),
                            'price' => $v->get_price() ? number_format( (float) $v->get_price() ) . ' ' . wp_strip_all_tags( get_woocommerce_currency_symbol() ) : wp_strip_all_tags( $v->get_price_html() ),
                            'url'   => home_url( '/?add-to-cart=' . $v->get_id() ),
                        ];
                    }
                }
            } else {
                $wc_items[] = [
                    'id'    => $p->get_id(),
                    'title' => $p->get_name(),
                    'price' => $p->get_price() ? number_format( (float) $p->get_price() ) . ' ' . wp_strip_all_tags( get_woocommerce_currency_symbol() ) : wp_strip_all_tags( $p->get_price_html() ),
                    'url'   => home_url( '/?add-to-cart=' . $p->get_id() ),
                ];
            }
        }
        $promos = get_posts( [ 'post_type' => 'elm_promo', 'post_status' => 'publish', 'numberposts' => 20 ] );
        ?>
        <div class="elm-promo-studio-grid">
            <div class="elm-card">
                <h2><?php esc_html_e( 'فرم بصری سازنده تبلیغات HTML متصل به قیمت‌های واقعی ووکامرس', 'epic-license-manager' ); ?></h2>
                <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="elm-form-grid" id="elm-promo-form">
                    <?php wp_nonce_field( 'elm_save_promo_nonce' ); ?>
                    <input type="hidden" name="action" value="elm_save_visual_promo" />
                    <label>اپلیکیشن هدف <select name="app_id">
                        <?php if ( is_array( $apps ) ) : foreach ( $apps as $a ) : ?>
                            <option value="<?php echo esc_attr( (string) $a->id ); ?>"><?php echo esc_html( (string) $a->app_name . ' (' . $a->app_slug . ')' ); ?></option>
                        <?php endforeach; endif; ?>
                    </select></label>
                    <label>نحوه نمایش در موبایل <select name="promo_display_mode">
                        <option value="floating_modal">پنجره شناور وسط صفحه (Floating Modal)</option>
                        <option value="bottom_sheet">پنجره کشویی پایین (Bottom Sheet)</option>
                        <option value="startup_banner">بنر شروع برنامه (Startup Banner)</option>
                    </select></label>
                    <label>فاصله تکرار (ثانیه) <input type="number" name="promo_interval_sec" value="180" min="15" /></label>
                    <label class="elm-inline-chk" style="align-self:end;"><input type="checkbox" name="promo_enabled" value="1" checked /> نمایش تبلیغ در اپ فعال باشد</label>

                    <?php if ( ! empty( $wc_items ) ) : ?>
                    <label class="elm-full">انتخاب محصول / متغیر ووکامرس برای تولید خودکار کارت قیمت و لینک خرید:
                        <select id="elm-wc-promo-picker">
                            <option value="">— انتخاب محصول یا متغیر ووکامرس —</option>
                            <?php foreach ( $wc_items as $wi ) : ?>
                                <option value="<?php echo esc_attr( (string) wp_json_encode( $wi, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) ); ?>"><?php echo esc_html( $wi['title'] . ' (' . $wi['price'] . ')' ); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                    <?php endif; ?>

                    <label>عنوان تبلیغ <input type="text" id="elm-promo-title" name="promo_title" required value="ارتقای نسخه حرفه‌ای اپلیکیشن" /></label>
                    <label>رنگ تاکیدی دکمه <input type="color" id="elm-promo-theme" name="promo_theme" value="#0f4c81" /></label>
                    <label>متن دکمه خرید (CTA) <input type="text" id="elm-promo-cta-label" name="promo_cta_label" value="خرید و دریافت آنی لایسنس" /></label>
                    <label>لینک مستقیم خرید / سبد ووکامرس <input type="url" id="elm-promo-cta-url" name="promo_cta_url" value="<?php echo esc_attr( home_url( '/shop' ) ); ?>" /></label>
                    <label class="elm-full">کد HTML تبلیغ (همگام با فرم بصری و پیش‌نمایش زنده) <textarea id="elm-promo-html" name="promo_html" rows="7" class="code">&lt;div dir="rtl" style="font-family:Tahoma,sans-serif;"&gt;&lt;span style="background:#e0f2fe;color:#0369a1;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:bold;"&gt;پیشنهاد ویژه کاربران&lt;/span&gt;&lt;h3 style="margin:10px 0 6px;"&gt;ارتقای آنی به نسخه کامل بدون محدودیت&lt;/h3&gt;&lt;p style="color:#475569;font-size:13px;line-height:1.7;"&gt;با تهیه اشتراک رسمی از فروشگاه، تمام قابلیت‌های پیشرفته و پشتیبانی دائمی برای دستگاه شما فعال می‌شود.&lt;/p&gt;&lt;/div&gt;</textarea></label>
                    <div class="elm-full"><button type="submit" class="button button-primary">انتشار در پست‌تایپ elm_promo و اتصال به اپلیکیشن</button></div>
                </form>
            </div>

            <div class="elm-card">
                <h3><?php esc_html_e( 'پیش‌نمایش زنده در قاب گوشی موبایل', 'epic-license-manager' ); ?></h3>
                <div class="elm-phone-bezel">
                    <div class="elm-phone-notch"><span>9:41</span><span>ELM WebView</span></div>
                    <iframe id="elm-promo-live-iframe" sandbox="allow-same-origin" style="width:100%;height:420px;border:0;background:#f8fafc;border-radius:14px;"></iframe>
                </div>
            </div>
        </div>

        <div class="elm-card">
            <h3><?php esc_html_e( 'تبلیغات منتشرشده (لینک سبک بدون هدر/فوتر + اندپوینت JSON)', 'epic-license-manager' ); ?></h3>
            <table class="widefat striped">
                <thead><tr><th>عنوان تبلیغ</th><th>لینک یکتای سبک (WebView)</th><th>متن دکمه</th><th>ویرایش</th></tr></thead>
                <tbody>
                <?php if ( empty( $promos ) ) : ?>
                    <tr><td colspan="4">هنوز تبلیغی منتشر نشده است.</td></tr>
                <?php else : foreach ( $promos as $pr ) :
                    $plink = get_permalink( $pr );
                    $clbl  = (string) get_post_meta( $pr->ID, '_elm_promo_cta_label', true );
                    ?>
                    <tr>
                        <td><strong><?php echo esc_html( $pr->post_title ); ?></strong></td>
                        <td><a href="<?php echo esc_url( (string) $plink ); ?>" target="_blank"><code><?php echo esc_html( (string) $plink ); ?></code></a></td>
                        <td><?php echo esc_html( $clbl ?: '—' ); ?></td>
                        <td><a href="<?php echo esc_url( (string) get_edit_post_link( $pr->ID ) ); ?>" class="button button-small">ویرایش CPT</a></td>
                    </tr>
                <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }

    private function render_simulator_tab(): void {
        global $wpdb;
        $apps = $wpdb->get_results( "SELECT id, app_slug, app_name, public_key_hex, public_key FROM {$wpdb->prefix}elm_apps ORDER BY id DESC" );
        ?>
        <div class="elm-sim-studio-grid">
            <div class="elm-card">
                <h2><?php esc_html_e( 'شبیه‌ساز واقعی گوشی و تستر زنده API داخل وردپرس', 'epic-license-manager' ); ?></h2>
                <p class="elm-muted">تمام عملیات زیر مستقیماً روی دیتابیس واقعی همین سایت و کلید Ed25519 واقعی اجرا می‌شوند و با برچسب Sandbox قابل تفکیک و پاک‌سازی هستند.</p>
                <div class="elm-form-grid">
                    <label>اپلیکیشن هدف <select id="elm-sim-app">
                        <?php if ( is_array( $apps ) ) : foreach ( $apps as $a ) : ?>
                            <option value="<?php echo esc_attr( (string) $a->app_slug ); ?>" data-hex="<?php echo esc_attr( (string) ( $a->public_key_hex ?: $this->crypto->b64_to_hex( (string) $a->public_key ) ) ); ?>"><?php echo esc_html( (string) $a->app_name . ' (' . $a->app_slug . ')' ); ?></option>
                        <?php endforeach; endif; ?>
                    </select></label>
                    <label>هش سخت‌افزار دستگاه (Android ID Hash)
                        <div style="display:flex;gap:6px;">
                            <input type="text" id="elm-sim-hw" value="android-hw-yektap-9f8e7d6c5b4a" class="code" style="flex:1;" />
                            <button type="button" id="elm-sim-newhw" class="button">دستگاه جدید</button>
                        </div>
                    </label>
                    <label>مدل گوشی و نسخه OS <input type="text" id="elm-sim-model" value="Samsung Galaxy S24 / Android 15" /></label>
                    <label>کلید لایسنس برای فعال‌سازی <input type="text" id="elm-sim-key" placeholder="ELM-XXXX-XXXX-XXXX-XXXX" class="code" /></label>
                </div>

                <div class="elm-sim-btn-grid">
                    <button type="button" class="button elm-sim-btn" data-op="handshake">۱. Handshake (دریافت کلید و قوانین)</button>
                    <button type="button" class="button button-primary elm-sim-btn" data-op="trial">۲. فعال‌سازی دوره آزمایشی (Trial)</button>
                    <button type="button" class="button elm-sim-btn" data-op="reinstall">۳. شبیه‌سازی حذف و نصب مجدد</button>
                    <button type="button" class="button elm-sim-btn" data-op="create_sandbox_license">۴. ساخت لایسنس تست Sandbox</button>
                    <button type="button" class="button button-primary elm-sim-btn" data-op="activate">۵. فعال‌سازی کلید لایسنس</button>
                    <button type="button" class="button elm-sim-btn" data-op="clock_tamper">۶. تست دستکاری ساعت (-۱۰ روز)</button>
                    <button type="button" class="button elm-sim-btn" data-op="key_mismatch">۷. تست عدم تطابق کلید Ed25519</button>
                    <button type="button" class="button elm-sim-btn" data-op="promo">۸. دریافت تبلیغ داخل گوشی (WebView)</button>
                    <button type="button" class="button elm-sim-btn" data-op="clear_sandbox" style="color:#b91c1c;border-color:#fca5a5;">پاک‌سازی کامل رکوردهای Sandbox</button>
                </div>

                <h3 style="margin-top:16px;">خروجی زنده REST / Token Inspector</h3>
                <pre id="elm-sim-output" class="elm-code-box">آماده تست؛ یکی از دکمه‌های بالا را بزنید تا درخواست واقعی روی سرور اجرا شود.</pre>
            </div>

            <div class="elm-card">
                <h3><?php esc_html_e( 'نمای موبایل کاربر نهایی', 'epic-license-manager' ); ?></h3>
                <div class="elm-phone-bezel" id="elm-phone-screen-wrap">
                    <div class="elm-phone-notch"><span>12:30</span><span>5G · Ed25519</span></div>
                    <div class="elm-phone-body" id="elm-phone-body">
                        <div class="elm-phone-status-card" id="elm-phone-status">
                            <span class="elm-badge warn">در انتظار همگام‌سازی</span>
                            <h4>اپلیکیشن آماده اتصال</h4>
                            <p>برای تست دوره آزمایشی، لایسنس یا دستکاری ساعت از پنل کنار استفاده کنید.</p>
                        </div>
                        <div class="elm-phone-features">
                            <div class="elm-feat-item"><span>گزارش پیشرفته PDF/Excel</span><strong id="elm-feat-state">قفل</strong></div>
                            <div class="elm-feat-item"><span>همگام‌سازی ابری آفلاین</span><strong id="elm-feat-state-2">قفل</strong></div>
                        </div>
                        <div id="elm-phone-promo-overlay" class="elm-phone-promo-modal" style="display:none;">
                            <div id="elm-phone-promo-content"></div>
                            <button type="button" class="button" id="elm-phone-promo-close" style="margin-top:8px;width:100%;">بستن تبلیغ (Close Bridge)</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <?php
    }

    private function render_sdk_builder_tab(): void {
        global $wpdb;
        $apps  = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}elm_apps ORDER BY id DESC" );
        $home  = untrailingslashit( home_url() );
        $items = [];
        if ( is_array( $apps ) ) {
            foreach ( $apps as $a ) {
                $items[] = [
                    'name'       => (string) $a->app_name,
                    'slug'       => (string) $a->app_slug,
                    'platform'   => (string) $a->platform,
                    'mode'       => (string) $a->license_mode,
                    'trialDays'  => (int) $a->trial_days,
                    'graceDays'  => (int) $a->offline_grace_days,
                    'pubHex'     => (string) ( $a->public_key_hex ?: $this->crypto->b64_to_hex( (string) $a->public_key ) ),
                    'pubB64'     => (string) $a->public_key,
                    'gated'      => (string) $a->gated_features,
                    'buyUrl'     => (string) $a->purchase_url,
                ];
            }
        }
        ?>
        <div class="elm-card">
            <h2><?php esc_html_e( 'بسته‌ساز و کدساز واقعی متصل به سایت شما (Kotlin, Gradle, Web, Manifest & AI Studio Prompt)', 'epic-license-manager' ); ?></h2>
            <p>دامنه و کلید ۶۴ کاراکتری Ed25519 اپلیکیشن انتخاب‌شده به‌صورت مستقیم داخل کدهای زیر تزریق می‌شوند تا هیچ‌گونه خطای کلید یا پیوندیکتای ساده رخ ندهد.</p>
            <div class="elm-filter-bar">
                <label>انتخاب اپلیکیشن:
                    <select id="elm-sdk-app-select" data-home="<?php echo esc_attr( $home ); ?>" data-apps="<?php echo esc_attr( (string) wp_json_encode( $items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) ); ?>">
                        <?php if ( empty( $items ) ) : ?>
                            <option value="0">اپلیکیشن نمونه (my-app)</option>
                        <?php else : foreach ( $items as $idx => $it ) : ?>
                            <option value="<?php echo esc_attr( (string) $idx ); ?>"><?php echo esc_html( $it['name'] . ' (' . $it['slug'] . ')' ); ?></option>
                        <?php endforeach; endif; ?>
                    </select>
                </label>
                <div class="elm-sdk-tabs">
                    <button type="button" class="button button-primary elm-sdk-tab" data-kind="kotlin">EpicLicenseClient.kt</button>
                    <button type="button" class="button elm-sdk-tab" data-kind="gradle">build.gradle.kts</button>
                    <button type="button" class="button elm-sdk-tab" data-kind="web">elm-client.ts (Web)</button>
                    <button type="button" class="button elm-sdk-tab" data-kind="manifest">elm-manifest.json</button>
                    <button type="button" class="button elm-sdk-tab" data-kind="prompt">AI Studio Prompt</button>
                </div>
                <button type="button" id="elm-sdk-copy" class="button">کپی کد</button>
                <button type="button" id="elm-sdk-download" class="button button-primary">دانلود فایل</button>
            </div>
            <textarea id="elm-sdk-code-output" rows="20" class="large-text code" readonly style="direction:ltr;text-align:left;"></textarea>
        </div>
        <?php
    }

    private function render_settings_tab(): void {
        $cal      = $this->calendar->get_settings();
        $wc       = get_option( 'elm_wc_settings', [] );
        $statuses = is_array( $wc['trigger_statuses'] ?? null ) ? $wc['trigger_statuses'] : [ 'completed' ];
        $mu_ok    = $this->is_mu_patch_installed();
        $now_ts   = time();
        ?>
        <div class="elm-promo-studio-grid">
            <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="elm-card">
                <?php wp_nonce_field( 'elm_save_settings_nonce' ); ?>
                <input type="hidden" name="action" value="elm_save_settings" />
                <h2><?php esc_html_e( 'تنظیمات مستقل تقویم‌ها (میلادی / شمسی / قمری)', 'epic-license-manager' ); ?></h2>
                <p class="elm-muted">بدون دستکاری فایل‌های هسته وردپرس و بدون اختلال در REST API و کوئری‌های پایگاه داده.</p>
                <table class="form-table">
                    <tr><th>بخش عمومی سایت</th><td><?php $this->render_cal_select( 'cal_public', $cal['public'] ); ?></td></tr>
                    <tr><th>پیشخوان ادمین وردپرس</th><td><?php $this->render_cal_select( 'cal_admin', $cal['admin'] ); ?></td></tr>
                    <tr><th>رابط کاربری افزونه</th><td><?php $this->render_cal_select( 'cal_plugin', $cal['plugin'] ); ?></td></tr>
                </table>
                <div class="elm-subpanel">
                    <strong>پیش‌نمایش امروز در ۳ تقویم:</strong><br>
                    میلادی: <code><?php echo esc_html( $this->calendar->format_timestamp( $now_ts, 'gregorian', false ) ); ?></code> ·
                    شمسی: <code><?php echo esc_html( $this->calendar->format_timestamp( $now_ts, 'jalali', false ) ); ?></code> ·
                    قمری: <code><?php echo esc_html( $this->calendar->format_timestamp( $now_ts, 'hijri', false ) ); ?></code>
                </div>

                <h2 style="margin-top:20px;"><?php esc_html_e( 'رفتار هوشمند تسویه‌حساب ووکامرس', 'epic-license-manager' ); ?></h2>
                <p><label class="elm-inline-chk"><input type="checkbox" name="wc_conditional_cart_reg" value="1" <?php checked( ! empty( $wc['conditional_cart_registration'] ) ); ?> /> <strong>الزام ثبت‌نام/ورود فقط زمانی که سبد خرید شامل محصول لایسنس‌دار باشد</strong> (تنظیمات پرداخت مهمان برای محصولات عادی دست‌نخورده می‌ماند).</label></p>
                <p><strong>وضعیت‌های سفارش برای صدور خودکار لایسنس:</strong></p>
                <?php foreach ( [ 'completed' => 'تکمیل شده (Completed)', 'processing' => 'در حال انجام (Processing)', 'on-hold' => 'در انتظار بررسی (On Hold)' ] as $st => $label ) : ?>
                    <label class="elm-inline-chk" style="margin-inline-end:16px;"><input type="checkbox" name="wc_trigger_statuses[]" value="<?php echo esc_attr( $st ); ?>" <?php checked( in_array( $st, $statuses, true ) ); ?> /> <?php echo esc_html( $label ); ?></label>
                <?php endforeach; ?>
                <p class="submit"><button type="submit" class="button button-primary">ذخیره تنظیمات تقویم و ووکامرس</button></p>
            </form>

            <div class="elm-card">
                <h2><?php esc_html_e( 'سلامت سیستم، پچ MU-Plugin و تست زنده REST API', 'epic-license-manager' ); ?></h2>
                <ul class="elm-diag-list">
                    <li>نسخه PHP سرور: <strong><?php echo esc_html( PHP_VERSION ); ?></strong></li>
                    <li>اکستنشن PHP Sodium (Ed25519): <strong><?php echo $this->crypto->is_sodium_available() ? 'فعال و آماده امضا' : 'غیرفعال (نیاز به فعال‌سازی)'; ?></strong></li>
                    <li>سازگاری WooCommerce HPOS: <strong>اعلام شده (custom_order_tables = true)</strong></li>
                    <li>فایل محافظ <code>wp-content/mu-plugins/elm-plain-permalink-fix.php</code>: <strong><?php echo $mu_ok ? 'نصب و فعال' : 'نصب نشده'; ?></strong></li>
                </ul>
                <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin:12px 0;">
                    <?php wp_nonce_field( 'elm_reinstall_mu_nonce' ); ?>
                    <input type="hidden" name="action" value="elm_reinstall_mu_patch" />
                    <button type="submit" class="button">نصب / ترمیم مجدد فایل MU-Plugin</button>
                    <button type="button" id="elm-run-rest-diag" class="button button-primary">تست زنده هر ۲ مسیر REST API</button>
                </form>
                <pre id="elm-diag-output" class="elm-code-box" style="min-height:160px;">برای بررسی اینکه خروجی REST سایت شما JSON معتبر برمی‌گرداند (و نه &lt;!DOCTYPE)، روی «تست زنده هر ۲ مسیر REST API» کلیک کنید.</pre>
            </div>
        </div>
        <?php
    }

    private function render_cal_select( string $name, string $current ): void {
        echo '<select name="' . esc_attr( $name ) . '">';
        foreach ( [ 'gregorian' => 'میلادی (Gregorian)', 'jalali' => 'شمسی (Jalali)', 'hijri' => 'قمری (Hijri)' ] as $k => $v ) {
            echo '<option value="' . esc_attr( $k ) . '"' . selected( $current, $k, false ) . '>' . esc_html( $v ) . '</option>';
        }
        echo '</select>';
    }
}
`;
}

export function buildAssetsAndI18n(): {
  adminCss: string;
  adminJs: string;
  potFile: string;
  faPoFile: string;
  aiBlueprintMd: string;
} {
  const adminCss = `.elm-studio-wrap { max-width: 1380px; margin-top: 16px; font-family: Vazirmatn, Tahoma, system-ui, -apple-system, sans-serif; color: #0f172a; }
.elm-studio-header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; margin-bottom: 14px; }
.elm-studio-header h1 { margin: 0; font-size: 19px; font-weight: 700; color: #0f172a; }
.elm-studio-header p { margin: 4px 0 0; font-size: 12px; color: #64748b; }
.elm-header-badges { display: flex; gap: 8px; flex-wrap: wrap; }
.elm-pill { padding: 5px 10px; border-radius: 8px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; }
.elm-pill.ok { background: #ecfdf5; color: #065f46; border-color: #a7f3d0; }
.elm-pill.warn { background: #fffbeb; color: #92400e; border-color: #fde68a; }
.elm-pill.err { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
.elm-studio-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.elm-tab { text-decoration: none; padding: 9px 14px; border-radius: 8px; background: #fff; border: 1px solid #e2e8f0; color: #334155; font-size: 12px; font-weight: 600; transition: all .15s; }
.elm-tab:hover { border-color: #0f4c81; color: #0f4c81; }
.elm-tab.active { background: #0f4c81; border-color: #0f4c81; color: #fff; }
.elm-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
.elm-kpi-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
.elm-kpi-card span { font-size: 12px; color: #64748b; }
.elm-kpi-card strong { font-size: 21px; color: #0f172a; font-variant-numeric: tabular-nums; }
.elm-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
.elm-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.elm-subpanel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-bottom: 12px; }
.elm-muted { color: #64748b; font-size: 12px; }
.elm-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.elm-form-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: #334155; }
.elm-form-grid label.elm-inline-chk { flex-direction: row; align-items: center; gap: 6px; font-weight: 500; }
.elm-form-grid .elm-full { grid-column: 1 / -1; }
.elm-filter-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; align-items: center; }
.elm-extra-cols-bar { width: 100%; display: flex; flex-wrap: wrap; gap: 12px; padding-top: 8px; border-top: 1px dashed #e2e8f0; font-size: 12px; }
.elm-inline-chk { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; }
.elm-table-scroll { overflow-x: auto; }
.elm-badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; }
.elm-badge.ok { background: #dcfce7; color: #166534; }
.elm-badge.warn { background: #fef3c7; color: #92400e; }
.elm-badge.err { background: #fee2e2; color: #991b1b; }
.elm-group-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 8px; background: #f8fafc; }
.elm-cf-row-card { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; padding: 10px; background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 8px; align-items: end; }
.elm-promo-studio-grid, .elm-sim-studio-grid { display: grid; grid-template-columns: 1.35fr 0.9fr; gap: 16px; align-items: start; }
@media (max-width: 1024px) { .elm-promo-studio-grid, .elm-sim-studio-grid { grid-template-columns: 1fr; } }
.elm-phone-bezel { max-width: 340px; margin: 0 auto; background: #0f172a; border: 6px solid #1e293b; border-radius: 28px; padding: 12px; box-shadow: 0 18px 36px rgba(15,23,42,.22); color: #f8fafc; position: relative; }
.elm-phone-notch { display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; padding: 0 8px 8px; border-bottom: 1px solid #1e293b; margin-bottom: 10px; }
.elm-phone-body { min-height: 410px; display: flex; flex-direction: column; gap: 12px; position: relative; }
.elm-phone-status-card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 14px; }
.elm-phone-status-card h4 { margin: 8px 0 4px; color: #fff; font-size: 15px; }
.elm-phone-status-card p { margin: 0; font-size: 12px; color: #cbd5e1; }
.elm-phone-features { display: flex; flex-direction: column; gap: 8px; }
.elm-feat-item { background: #1e293b; border-radius: 10px; padding: 10px 12px; display: flex; justify-content: space-between; font-size: 12px; }
.elm-phone-promo-modal { position: absolute; inset: 10px; background: #fff; color: #0f172a; border-radius: 16px; padding: 14px; overflow: auto; box-shadow: 0 12px 30px rgba(0,0,0,.45); }
.elm-sim-btn-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; margin-top: 14px; }
.elm-code-box { background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 10px; font-size: 12px; overflow: auto; min-height: 200px; margin: 0; direction: ltr; text-align: left; }
.elm-sdk-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.elm-diag-list { list-style: disc; padding-inline-start: 20px; line-height: 1.9; }
.elm-modal { position: fixed; inset: 0; background: rgba(15,23,42,.55); display: flex; align-items: center; justify-content: center; z-index: 99999; }
.elm-modal-box { background: #fff; border-radius: 14px; padding: 20px; max-width: 640px; width: 92%; }
`;

  const adminJs = `document.addEventListener('DOMContentLoaded', () => {
  const escAttr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 1. Key & Live Signature Verification Modal
  const modal = document.getElementById('elm-key-modal');
  document.querySelectorAll('.elm-open-key-modal').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!modal) return;
      const appId = btn.getAttribute('data-app-id');
      const hex = btn.getAttribute('data-hex') || '';
      const b64 = btn.getAttribute('data-b64') || '';
      modal.innerHTML = '<div class="elm-modal-box"><h3>کلیدهای عمومی Ed25519 و تست زنده امضای توکن</h3>' +
        '<p><strong>Public Key Hex (64-char for Android Kotlin):</strong><br><code style="word-break:break-all">' + escAttr(hex) + '</code></p>' +
        '<p><strong>Public Key Base64 (Web / PHP):</strong><br><code style="word-break:break-all">' + escAttr(b64) + '</code></p>' +
        '<p><label>کلید Hex یا Base64 داخل کد کلاینت را برای تست تطابق وارد کنید:</label><input type="text" id="elm-test-client-hex" class="large-text code" value="' + escAttr(hex) + '" /></p>' +
        '<p><button type="button" id="elm-run-sig-test" class="button button-primary">امضای توکن و بررسی تطابق</button> ' +
        '<button type="button" id="elm-close-key-modal" class="button">بستن</button></p>' +
        '<pre id="elm-sig-result" class="elm-code-box" style="min-height:90px;"></pre></div>';
      modal.style.display = 'flex';
      document.getElementById('elm-close-key-modal').onclick = () => { modal.style.display = 'none'; };
      document.getElementById('elm-run-sig-test').onclick = async () => {
        const clientKey = document.getElementById('elm-test-client-hex').value;
        const fd = new FormData();
        fd.append('action', 'elm_test_signature');
        fd.append('nonce', ELM_ADMIN_CFG.nonce);
        fd.append('app_id', appId);
        fd.append('client_public_key', clientKey);
        const r = await fetch(ELM_ADMIN_CFG.ajaxUrl, { method: 'POST', body: fd });
        const j = await r.json();
        document.getElementById('elm-sig-result').textContent = JSON.stringify(j, null, 2);
      };
    });
  });

  // 2. Manifest Importer & Downloader
  const toggleManifestBtn = document.getElementById('elm-toggle-manifest-import');
  const manifestBox = document.getElementById('elm-manifest-import-box');
  if (toggleManifestBtn && manifestBox) {
    toggleManifestBtn.addEventListener('click', () => {
      manifestBox.style.display = manifestBox.style.display === 'none' ? 'block' : 'none';
    });
  }
  const manifestFileInput = document.getElementById('elm-manifest-file-input');
  if (manifestFileInput) {
    manifestFileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const ta = document.getElementById('elm-manifest-json-text');
        if (ta) ta.value = String(reader.result || '');
      };
      reader.readAsText(f);
    });
  }
  const applyManifestBtn = document.getElementById('elm-apply-manifest-btn');
  if (applyManifestBtn) {
    applyManifestBtn.addEventListener('click', () => {
      try {
        const raw = document.getElementById('elm-manifest-json-text').value;
        const m = JSON.parse(raw);
        if (m.app_name) document.getElementById('elm-app-name').value = m.app_name;
        if (m.app_slug) document.getElementById('elm-app-slug').value = m.app_slug;
        if (m.platform) document.getElementById('elm-app-platform').value = m.platform;
        if (m.license_mode) document.getElementById('elm-app-mode').value = m.license_mode;
        if (m.trial_days !== undefined) document.getElementById('elm-app-trial').value = m.trial_days;
        if (m.offline_grace_days !== undefined) document.getElementById('elm-app-grace').value = m.offline_grace_days;
        if (m.purchase_url) document.getElementById('elm-app-url').value = m.purchase_url;
        if (Array.isArray(m.gated_features)) document.getElementById('elm-app-gated').value = m.gated_features.join(', ');
      } catch (err) {
        console.error(err);
      }
    });
  }
  document.querySelectorAll('.elm-dl-manifest').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slug = btn.getAttribute('data-slug') || 'app';
      const content = btn.getAttribute('data-manifest') || '{}';
      const blob = new Blob([content], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'elm-manifest-' + slug + '.json';
      a.click();
    });
  });

  // 3. ACF-Style Visual Custom Field & Condition Builder
  const cfForm = document.getElementById('elm-cf-builder-form');
  if (cfForm) {
    const fieldsInput = document.getElementById('elm-cf-fields-json');
    const condsInput = document.getElementById('elm-cf-conds-json');
    const fieldsList = document.getElementById('elm-cf-fields-list');
    const condsList = document.getElementById('elm-cf-conds-list');
    let fields = [];
    let conds = [];
    try { fields = JSON.parse(fieldsInput.value || '[]'); } catch { fields = []; }
    try { conds = JSON.parse(condsInput.value || '[]'); } catch { conds = []; }

    const fieldTypes = [
      ['text', 'متن کوتاه (Text)'], ['number', 'عدد (Number)'], ['email', 'ایمیل (Email)'],
      ['url', 'لینک (URL)'], ['textarea', 'متن بلند (Textarea)'], ['select', 'لیست کشویی (Select)'],
      ['checkbox', 'چندانتخابی (Checkbox)'], ['radio', 'دکمه رادیویی (Radio)'], ['true_false', 'بله / خیر (True/False)'],
      ['date_triple', 'تاریخ سه‌گانه (شمسی/قمری/میلادی)'], ['media', 'فایل / تصویر رسانه (Media)'], ['repeater', 'تکرارشونده (Repeater)']
    ];
    const condParams = [
      ['user_logged_in', 'وضعیت ورود کاربر (yes/no)'], ['user_role', 'نقش کاربر (customer/administrator)'],
      ['page_id', 'شناسه برگه/نوشته (ID)'], ['url_pattern', 'الگوی آدرس URL'],
      ['wc_product_type', 'نوع محصول ووکامرس (simple/variable)'], ['wc_variation_id', 'شناسه متغیر ووکامرس'],
      ['field_equals', 'مقدار فیلد دیگر (name:value)'], ['has_active_license', 'داشتن لایسنس فعال اپیک (yes/no)']
    ];

    const syncHidden = () => {
      fieldsInput.value = JSON.stringify(fields);
      condsInput.value = JSON.stringify(conds);
    };

    const renderCF = () => {
      fieldsList.innerHTML = '';
      fields.forEach((f, idx) => {
        const row = document.createElement('div');
        row.className = 'elm-cf-row-card';
        const optsHtml = fieldTypes.map(([k, lbl]) => '<option value="' + escAttr(k) + '"' + (f.type === k ? ' selected' : '') + '>' + escAttr(lbl) + '</option>').join('');
        row.innerHTML =
          '<label>برچسب فارسی<input type="text" data-k="label" value="' + escAttr(f.label || '') + '" /></label>' +
          '<label>نام متا (انگلیسی)<input type="text" data-k="name" class="code" value="' + escAttr(f.name || '') + '" /></label>' +
          '<label>نوع فیلد<select data-k="type">' + optsHtml + '</select></label>' +
          '<label>گزینه‌ها (با کاما)<input type="text" data-k="choices" value="' + escAttr(Array.isArray(f.choices) ? f.choices.join(',') : (f.choices || '')) + '" /></label>' +
          '<label class="elm-inline-chk"><input type="checkbox" data-k="showInReport"' + (f.showInReport ? ' checked' : '') + ' /> ستون گزارش و اکسل</label>' +
          '<div><button type="button" class="button button-small elm-cf-rm">حذف</button></div>';
        row.querySelectorAll('input, select').forEach((el) => {
          el.addEventListener('input', () => {
            const k = el.getAttribute('data-k');
            if (k === 'showInReport') fields[idx][k] = el.checked;
            else if (k === 'choices') fields[idx][k] = el.value.split(',').map(s => s.trim()).filter(Boolean);
            else fields[idx][k] = el.value;
            syncHidden();
          });
        });
        row.querySelector('.elm-cf-rm').onclick = () => { fields.splice(idx, 1); syncHidden(); renderCF(); };
        fieldsList.appendChild(row);
      });

      condsList.innerHTML = '';
      conds.forEach((c, idx) => {
        const row = document.createElement('div');
        row.className = 'elm-cf-row-card';
        const pHtml = condParams.map(([k, lbl]) => '<option value="' + escAttr(k) + '"' + (c.param === k ? ' selected' : '') + '>' + escAttr(lbl) + '</option>').join('');
        row.innerHTML =
          '<label>شرط<select data-k="param">' + pHtml + '</select></label>' +
          '<label>عملگر<select data-k="operator">' +
            '<option value="equals"' + (c.operator === 'equals' ? ' selected' : '') + '>مساوی باشد (equals)</option>' +
            '<option value="not_equals"' + (c.operator === 'not_equals' ? ' selected' : '') + '>مساوی نباشد (not_equals)</option>' +
            '<option value="contains"' + (c.operator === 'contains' ? ' selected' : '') + '>شامل باشد (contains)</option>' +
          '</select></label>' +
          '<label>مقدار<input type="text" data-k="value" value="' + escAttr(c.value || '') + '" /></label>' +
          '<div><button type="button" class="button button-small elm-cond-rm">حذف شرط</button></div>';
        row.querySelectorAll('input, select').forEach((el) => {
          el.addEventListener('input', () => { conds[idx][el.getAttribute('data-k')] = el.value; syncHidden(); });
        });
        row.querySelector('.elm-cond-rm').onclick = () => { conds.splice(idx, 1); syncHidden(); renderCF(); };
        condsList.appendChild(row);
      });
      syncHidden();
    };

    document.getElementById('elm-cf-add-field').onclick = () => {
      fields.push({ name: 'custom_field_' + (fields.length + 1), label: 'فیلد جدید', type: 'text', choices: [], showInReport: false });
      renderCF();
    };
    document.getElementById('elm-cf-add-cond').onclick = () => {
      conds.push({ param: 'user_logged_in', operator: 'equals', value: 'yes' });
      renderCF();
    };
    renderCF();
  }

  // 4. Visual HTML Promo Builder + WC Picker + Live Iframe Preview
  const promoIframe = document.getElementById('elm-promo-live-iframe');
  if (promoIframe) {
    const htmlEl = document.getElementById('elm-promo-html');
    const urlEl = document.getElementById('elm-promo-cta-url');
    const lblEl = document.getElementById('elm-promo-cta-label');
    const themeEl = document.getElementById('elm-promo-theme');
    const wcPicker = document.getElementById('elm-wc-promo-picker');

    const updatePromoPreview = () => {
      const color = themeEl ? themeEl.value : '#0f4c81';
      const lbl = lblEl ? lblEl.value : 'خرید لایسنس';
      const bodyHtml = htmlEl ? htmlEl.value : '';
      const doc = '<!doctype html><html dir="rtl"><body style="margin:0;padding:14px;background:#f8fafc;font-family:Tahoma,sans-serif;">' +
        '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;">' + bodyHtml +
        '<a href="#" onclick="return false;" style="display:block;text-align:center;background:' + color + ';color:#fff;padding:11px;border-radius:10px;text-decoration:none;font-weight:bold;margin-top:14px;">' + lbl + '</a>' +
        '<div style="text-align:center;color:#64748b;font-size:12px;margin-top:10px;">بستن پنجره</div></div></body></html>';
      promoIframe.srcdoc = doc;
    };

    [htmlEl, urlEl, lblEl, themeEl].forEach((el) => { if (el) el.addEventListener('input', updatePromoPreview); });
    if (wcPicker) {
      wcPicker.addEventListener('change', () => {
        if (!wcPicker.value) return;
        try {
          const item = JSON.parse(wcPicker.value);
          if (urlEl) urlEl.value = item.url || '';
          if (lblEl) lblEl.value = 'خرید آنی (' + item.price + ')';
          if (htmlEl) {
            htmlEl.value = '<div dir="rtl" style="font-family:Tahoma,sans-serif;">' +
              '<span style="background:#e0f2fe;color:#0369a1;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:bold;">پیشنهاد ووکامرس</span>' +
              '<h3 style="margin:10px 0 6px;">' + item.title + '</h3>' +
              '<p style="font-size:18px;font-weight:bold;color:#0f4c81;margin:4px 0;">' + item.price + '</p>' +
              '<p style="color:#475569;font-size:13px;">فعالسازی فوری روی اپلیکیشن پس از تکمیل سفارش</p></div>';
          }
          updatePromoPreview();
        } catch {}
      });
    }
    updatePromoPreview();
  }

  // 5. In-WordPress Modern Phone Simulator
  const simOut = document.getElementById('elm-sim-output');
  const phoneStatus = document.getElementById('elm-phone-status');
  const promoOverlay = document.getElementById('elm-phone-promo-overlay');
  const promoCloseBtn = document.getElementById('elm-phone-promo-close');
  if (promoCloseBtn && promoOverlay) {
    promoCloseBtn.onclick = () => { promoOverlay.style.display = 'none'; };
  }
  const newHwBtn = document.getElementById('elm-sim-newhw');
  if (newHwBtn) {
    newHwBtn.onclick = () => {
      document.getElementById('elm-sim-hw').value = 'android-hw-' + Math.random().toString(16).slice(2, 12);
    };
  }
  document.querySelectorAll('.elm-sim-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const op = btn.getAttribute('data-op');
      const appSel = document.getElementById('elm-sim-app');
      const hw = document.getElementById('elm-sim-hw').value;
      const model = document.getElementById('elm-sim-model').value;
      const licKey = document.getElementById('elm-sim-key').value;

      if (op === 'clock_tamper') {
        if (phoneStatus) phoneStatus.innerHTML = '<span class="elm-badge err">CLOCK TAMPER DETECTED</span><h4>دستکاری ساعت دستگاه شناسایی شد</h4><p>ساعت گوشی ۱۰ روز به عقب کشیده شده و با زمان امضاشده سرور مغایرت دارد.</p>';
        if (simOut) simOut.textContent = JSON.stringify({ ok: false, error: 'clock_tampering_detected', clock_drift_hours: -240 }, null, 2);
        return;
      }
      if (op === 'key_mismatch') {
        if (phoneStatus) phoneStatus.innerHTML = '<span class="elm-badge err">ED25519 MISMATCH</span><h4>خطای عدم تطابق کلید عمومی</h4><p>کلید Hex داخل کلاینت با کلید عمومی ثبت‌شده در وردپرس همخوانی ندارد. برای رفع خطا به تب اپلیکیشن‌ها بروید.</p>';
        if (simOut) simOut.textContent = JSON.stringify({ ok: false, error: 'ed25519_public_key_mismatch', server_hex: appSel.options[appSel.selectedIndex]?.getAttribute('data-hex') }, null, 2);
        return;
      }

      const effectiveOp = op === 'reinstall' ? 'trial' : op;
      const fd = new FormData();
      fd.append('action', 'elm_sim_action');
      fd.append('nonce', ELM_ADMIN_CFG.nonce);
      fd.append('op', effectiveOp);
      fd.append('app_slug', appSel.value);
      fd.append('hardware_hash', hw);
      fd.append('device_model', model);
      fd.append('license_key', licKey);

      const r = await fetch(ELM_ADMIN_CFG.ajaxUrl, { method: 'POST', body: fd });
      const j = await r.json();
      if (simOut) simOut.textContent = JSON.stringify(j, null, 2);

      const d = j.data && j.data.data ? j.data.data : (j.data || {});
      if (effectiveOp === 'create_sandbox_license' && d.license_key) {
        document.getElementById('elm-sim-key').value = d.license_key;
      }
      if (effectiveOp === 'promo' && d.html && promoOverlay) {
        document.getElementById('elm-phone-promo-content').innerHTML = d.html;
        promoOverlay.style.display = 'block';
        return;
      }
      if (phoneStatus) {
        if (d.ok && d.payload) {
          phoneStatus.innerHTML = '<span class="elm-badge ok">' + (d.payload.type || 'ACTIVE').toUpperCase() + ' · Ed25519 VERIFIED</span><h4>' + (d.payload.app_slug || '') + ' فعال شد</h4><p>انقضا: ' + (d.payload.expires_at_utc || 'دائمی') + '</p>';
          document.getElementById('elm-feat-state').textContent = 'باز';
          document.getElementById('elm-feat-state-2').textContent = 'باز';
        } else if (d.error) {
          phoneStatus.innerHTML = '<span class="elm-badge err">' + d.error + '</span><h4>عدم مجوز دسترسی</h4><p>' + (d.message || 'دوره آزمایشی قبلاً روی این سخت‌افزار مصرف شده یا کلید نامعتبر است.') + '</p>';
          document.getElementById('elm-feat-state').textContent = 'قفل';
          document.getElementById('elm-feat-state-2').textContent = 'قفل';
        }
      }
    });
  });

  // 6. Real SDK & AI Studio Prompt Builder
  const sdkSel = document.getElementById('elm-sdk-app-select');
  const sdkOut = document.getElementById('elm-sdk-code-output');
  if (sdkSel && sdkOut) {
    let apps = [];
    try { apps = JSON.parse(sdkSel.getAttribute('data-apps') || '[]'); } catch { apps = []; }
    const home = sdkSel.getAttribute('data-home') || ELM_ADMIN_CFG.homeUrl;
    let activeKind = 'kotlin';

    const getApp = () => apps[Number(sdkSel.value)] || {
      name: 'My App', slug: 'my-app', platform: 'android', mode: 'method2_trial',
      trialDays: 14, graceDays: 14, pubHex: '', pubB64: '', gated: 'pro_export', buyUrl: home + '/shop'
    };

    const renderCode = () => {
      const a = getApp();
      if (activeKind === 'kotlin') {
        sdkOut.value = '// Generated directly for ' + home + ' (' + a.slug + ')\\n' +
          'package com.epic.license\\n\\n' +
          'import android.provider.Settings\\n' +
          'import android.content.Context\\n' +
          'import org.json.JSONObject\\n' +
          'import java.net.HttpURLConnection\\n' +
          'import java.net.URL\\n' +
          'import java.security.MessageDigest\\n\\n' +
          'object EpicLicenseClient {\\n' +
          '    const val BASE_URL = "' + home + '/wp-json/elm/v1"\\n' +
          '    const val FALLBACK_BASE = "' + home + '/?rest_route=/elm/v1"\\n' +
          '    const val APP_SLUG = "' + a.slug + '"\\n' +
          '    const val PUBLIC_KEY_HEX = "' + a.pubHex + '"\\n' +
          '    const val TRIAL_DAYS = ' + a.trialDays + '\\n' +
          '    const val OFFLINE_GRACE_DAYS = ' + a.graceDays + '\\n\\n' +
          '    fun hardwareFingerprint(ctx: Context): String {\\n' +
          '        val androidId = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"\\n' +
          '        val digest = MessageDigest.getInstance("SHA-256").digest((androidId + ":" + APP_SLUG).toByteArray())\\n' +
          '        return digest.joinToString("") { "%02x".format(it) }\\n' +
          '    }\\n\\n' +
          '    fun postWithFallback(path: String, body: JSONObject): JSONObject {\\n' +
          '        val urls = listOf(BASE_URL + path, FALLBACK_BASE + path)\\n' +
          '        var lastErr = "network_error"\\n' +
          '        for (target in urls) {\\n' +
          '            try {\\n' +
          '                val conn = (URL(target).openConnection() as HttpURLConnection).apply {\\n' +
          '                    requestMethod = "POST"\\n' +
          '                    setRequestProperty("Content-Type", "application/json; charset=utf-8")\\n' +
          '                    setRequestProperty("Accept", "application/json")\\n' +
          '                    doOutput = true\\n' +
          '                }\\n' +
          '                conn.outputStream.use { it.write(body.toString().toByteArray()) }\\n' +
          '                val raw = (if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream).bufferedReader().readText().trim()\\n' +
          '                if (raw.startsWith("{")) return JSONObject(raw)\\n' +
          '                lastErr = "Non-JSON response (HTML/<!DOCTYPE)"\\n' +
          '            } catch (e: Exception) { lastErr = e.message ?: "error" }\\n' +
          '        }\\n' +
          '        return JSONObject().put("ok", false).put("error", lastErr)\\n' +
          '    }\\n' +
          '}\\n';
      } else if (activeKind === 'gradle') {
        sdkOut.value = '// build.gradle.kts (Module :app)\\ndependencies {\\n' +
          '    implementation("com.goterl:lazysodium-android:5.1.0@aar")\\n' +
          '    implementation("net.java.dev.jna:jna:5.14.0@aar")\\n' +
          '    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")\\n' +
          '}\\n';
      } else if (activeKind === 'web') {
        sdkOut.value = '// Epic License Manager Web Client (React / TypeScript)\\n' +
          'export const ELM_CONFIG = {\\n' +
          '  baseUrl: "' + home + '/wp-json/elm/v1",\\n' +
          '  fallbackBase: "' + home + '/?rest_route=/elm/v1",\\n' +
          '  appSlug: "' + a.slug + '",\\n' +
          '  publicKeyHex: "' + a.pubHex + '",\\n' +
          '  offlineGraceDays: ' + a.graceDays + '\\n' +
          '};\\n\\n' +
          'export async function elmRequest(path: string, body?: Record<string, unknown>) {\\n' +
          '  const endpoints = [ELM_CONFIG.baseUrl + path, ELM_CONFIG.fallbackBase + path];\\n' +
          '  for (const url of endpoints) {\\n' +
          '    const res = await fetch(url, {\\n' +
          '      method: body ? "POST" : "GET",\\n' +
          '      headers: { "Content-Type": "application/json", "Accept": "application/json" },\\n' +
          '      body: body ? JSON.stringify({ app_slug: ELM_CONFIG.appSlug, ...body }) : undefined,\\n' +
          '    });\\n' +
          '    const text = await res.text();\\n' +
          '    if (text.trim().startsWith("{")) return JSON.parse(text);\\n' +
          '  }\\n' +
          '  throw new Error("ELM REST endpoint returned non-JSON response");\\n' +
          '}\\n';
      } else if (activeKind === 'manifest') {
        sdkOut.value = JSON.stringify({
          app_name: a.name, app_slug: a.slug, platform: a.platform, license_mode: a.mode,
          trial_days: a.trialDays, offline_grace_days: a.graceDays, public_key_hex: a.pubHex,
          public_key_b64: a.pubB64, purchase_url: a.buyUrl, api_base: home + '/wp-json/elm/v1',
          fallback_base: home + '/?rest_route=/elm/v1'
        }, null, 2);
      } else {
        sdkOut.value = '# Google AI Studio / Android Studio Prompt\\n' +
          'Connect this app to Epic License Manager on WordPress:\\n' +
          '- Primary REST Base: ' + home + '/wp-json/elm/v1\\n' +
          '- Fallback REST Base (Plain Permalinks): ' + home + '/?rest_route=/elm/v1\\n' +
          '- App Slug: ' + a.slug + '\\n' +
          '- Ed25519 Public Key Hex (64 chars): ' + a.pubHex + '\\n' +
          '- Mode: ' + a.mode + ' (Trial: ' + a.trialDays + 'd, Offline Grace: ' + a.graceDays + 'd)\\n' +
          '- Gated Features: ' + a.gated + '\\n' +
          '- Purchase URL: ' + a.buyUrl + '\\n' +
          'Rules:\\n1. Always try BASE_URL and fallback to FALLBACK_BASE if response starts with <!DOCTYPE or <. Never treat HTML as JSON.\\n' +
          '2. Verify Ed25519 signed_token offline using PUBLIC_KEY_HEX and check monotonic/server clock against clock tampering.\\n' +
          '3. Load in-app promos from /promo?app_slug=' + a.slug + ' in a WebView with AndroidBridge.closePromo().';
      }
    };

    document.querySelectorAll('.elm-sdk-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.elm-sdk-tab').forEach(b => b.classList.remove('button-primary'));
        btn.classList.add('button-primary');
        activeKind = btn.getAttribute('data-kind') || 'kotlin';
        renderCode();
      });
    });
    sdkSel.addEventListener('change', renderCode);
    document.getElementById('elm-sdk-copy').onclick = () => { navigator.clipboard.writeText(sdkOut.value); };
    document.getElementById('elm-sdk-download').onclick = () => {
      const names = { kotlin: 'EpicLicenseClient.kt', gradle: 'build.gradle.kts', web: 'elm-client.ts', manifest: 'elm-manifest.json', prompt: 'AI_STUDIO_PROMPT.md' };
      const blob = new Blob([sdkOut.value], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = names[activeKind] || 'elm-code.txt';
      a.click();
    };
    renderCode();
  }

  // 7. Settings Live REST Permalink Diagnostic Test
  const diagBtn = document.getElementById('elm-run-rest-diag');
  const diagOut = document.getElementById('elm-diag-output');
  if (diagBtn && diagOut) {
    diagBtn.onclick = async () => {
      const urls = [
        ELM_ADMIN_CFG.restPrettyUrl + '/app/handshake?app_slug=__ping__',
        ELM_ADMIN_CFG.restQueryUrl + '/app/handshake&app_slug=__ping__'
      ];
      const report = [];
      for (const u of urls) {
        try {
          const res = await fetch(u, { headers: { Accept: 'application/json' } });
          const txt = await res.text();
          report.push({ url: u, httpStatus: res.status, isJson: txt.trim().startsWith('{'), preview: txt.slice(0, 140) });
        } catch (err) {
          report.push({ url: u, error: String(err) });
        }
      }
      diagOut.textContent = JSON.stringify(report, null, 2);
    };
  }
});
`;

  const potFile = `msgid ""
msgstr ""
"Project-Id-Version: Epic License Manager 2.0.0\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"X-Domain: epic-license-manager\\n"

msgid "Epic License Manager"
msgstr ""

msgid "My Licenses"
msgstr ""
`;

  const faPoFile = `msgid ""
msgstr ""
"Project-Id-Version: Epic License Manager 2.0.0\\n"
"Language: fa_IR\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"X-Domain: epic-license-manager\\n"

msgid "Epic License Manager"
msgstr "مدیریت لایسنس اپیک"

msgid "My Licenses"
msgstr "لایسنس‌های من"
`;

  const aiBlueprintMd = `# Epic License Manager v2 — AI Studio & Developer Integration Blueprint

## 1. Plain Permalink & JSON Safety
Clients automatically probe \`/wp-json/elm/v1/...\` and fall back to \`/?rest_route=/elm/v1/...\` with \`Accept: application/json\`.
Plugin activation automatically deploys \`wp-content/mu-plugins/elm-plain-permalink-fix.php\` and plugin deletion removes it cleanly.

## 2. Public Key Synchronization
Always embed the 64-character \`public_key_hex\` from WordPress Admin -> Epic Licenses -> Apps & Ed25519 Keys -> Keys & Test Sign.
`;

  return { adminCss, adminJs, potFile, faPoFile, aiBlueprintMd };
}
