export function buildReportsPhp(): string {
  return `<?php
/**
 * Dynamic Reporting Engine:
 * - Aggregates Sold/Generated Licenses, Remaining Duration, Customer Name, Mobile & Email
 * - Dynamically discovers WordPress User Meta, WooCommerce Customer Fields, and ACF User Field Groups
 * - Supports server-side filtering, sorting, and UTF-8 Excel (.xls SpreadsheetML / .csv) export
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class ELM_Reports {

    private ELM_Calendar $calendar;

    public function __construct( ELM_Calendar $calendar ) {
        $this->calendar = $calendar;
        add_action( 'admin_post_elm_export_excel', [ $this, 'handle_excel_export' ] );
    }

    /**
     * Returns all selectable customer columns (WP + WooCommerce + ACF User Fields).
     *
     * @return array<string, array{label: string, source: string}>
     */
    public function get_available_extra_columns(): array {
        $columns = [
            'wc_billing_city'     => [ 'label' => __( 'Billing City (WC)', 'epic-license-manager' ), 'source' => 'woocommerce' ],
            'wc_billing_company'  => [ 'label' => __( 'Company (WC)', 'epic-license-manager' ), 'source' => 'woocommerce' ],
            'wp_user_registered'  => [ 'label' => __( 'Account Registered Date (WP)', 'epic-license-manager' ), 'source' => 'wordpress' ],
        ];

        // Discover Advanced Custom Fields (ACF) attached to User profiles
        if ( function_exists( 'acf_get_field_groups' ) && function_exists( 'acf_get_fields' ) ) {
            $groups = acf_get_field_groups( [ 'user_form' => 'edit' ] );
            if ( empty( $groups ) ) {
                $groups = acf_get_field_groups();
            }
            if ( is_array( $groups ) ) {
                foreach ( $groups as $group ) {
                    $is_user_group = false;
                    if ( ! empty( $group['location'] ) && is_array( $group['location'] ) ) {
                        foreach ( $group['location'] as $rule_group ) {
                            foreach ( $rule_group as $rule ) {
                                if ( in_array( $rule['param'] ?? '', [ 'user_form', 'user_role', 'current_user' ], true ) ) {
                                    $is_user_group = true;
                                }
                            }
                        }
                    }
                    if ( ! $is_user_group ) {
                        continue;
                    }
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
     * @param array<string, mixed> $args
     * @return array<int, array<string, mixed>>
     */
    public function query_licenses( array $args = [] ): array {
        global $wpdb;
        $lic_table = $wpdb->prefix . 'elm_licenses';
        $app_table = $wpdb->prefix . 'elm_apps';

        $where  = [ '1=1' ];
        $params = [];

        if ( ! empty( $args['app_id'] ) ) {
            $where[]  = 'l.app_id = %d';
            $params[] = (int) $args['app_id'];
        }
        if ( ! empty( $args['status'] ) ) {
            $where[]  = 'l.status = %s';
            $params[] = sanitize_key( (string) $args['status'] );
        }
        if ( ! empty( $args['search'] ) ) {
            $like     = '%' . $wpdb->esc_like( (string) $args['search'] ) . '%';
            $where[]  = '(l.license_key LIKE %s OR u.user_email LIKE %s OR u.display_name LIKE %s)';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        $allowed_sort = [
            'id'         => 'l.id',
            'issued_at'  => 'l.issued_at',
            'expires_at' => 'l.expires_at',
            'status'     => 'l.status',
        ];
        $orderby = $allowed_sort[ $args['orderby'] ?? 'id' ] ?? 'l.id';
        $order   = ( strtoupper( (string) ( $args['order'] ?? 'DESC' ) ) === 'ASC' ) ? 'ASC' : 'DESC';

        $sql = "SELECT l.*, a.app_name, u.user_email, u.user_registered
                FROM {$lic_table} l
                INNER JOIN {$app_table} a ON a.id = l.app_id
                LEFT JOIN {$wpdb->users} u ON u.ID = l.user_id
                WHERE " . implode( ' AND ', $where ) . "
                ORDER BY {$orderby} {$order}
                LIMIT 500";

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
            $first_name = (string) get_user_meta( $uid, 'first_name', true );
            $last_name  = (string) get_user_meta( $uid, 'last_name', true );
            $mobile     = (string) get_user_meta( $uid, 'billing_phone', true );

            $item = [
                'license_key'    => (string) $row->license_key,
                'app_name'       => (string) $row->app_name,
                'order_id'       => (int) $row->order_id,
                'duration'       => (string) $row->duration_type,
                'status'         => (string) $row->status,
                'customer_name'  => trim( $first_name . ' ' . $last_name ) ?: '—',
                'customer_mobile'=> $mobile ?: '—',
                'customer_email' => (string) ( $row->user_email ?: '—' ),
                'issued_at'      => $this->calendar->format_mysql_datetime( (string) $row->issued_at, 'plugin', true ),
                'expires_at'     => $row->expires_at ? $this->calendar->format_mysql_datetime( (string) $row->expires_at, 'plugin', false ) : __( 'Lifetime', 'epic-license-manager' ),
                'remaining'      => $this->compute_remaining( $row->expires_at ? (string) $row->expires_at : null ),
            ];

            foreach ( $extra_columns as $col_key ) {
                $col_key = sanitize_key( (string) $col_key );
                if ( 'wc_billing_city' === $col_key ) {
                    $item[ $col_key ] = (string) ( get_user_meta( $uid, 'billing_city', true ) ?: '—' );
                } elseif ( 'wc_billing_company' === $col_key ) {
                    $item[ $col_key ] = (string) ( get_user_meta( $uid, 'billing_company', true ) ?: '—' );
                } elseif ( 'wp_user_registered' === $col_key ) {
                    $item[ $col_key ] = $this->calendar->format_mysql_datetime( (string) $row->user_registered, 'plugin', false );
                } elseif ( str_starts_with( $col_key, 'acf_' ) && function_exists( 'get_field' ) ) {
                    $acf_name = substr( $col_key, 4 );
                    $val      = get_field( $acf_name, 'user_' . $uid );
                    $item[ $col_key ] = is_scalar( $val ) ? (string) $val : ( is_array( $val ) ? implode( ', ', $val ) : '—' );
                }
            }

            $result[] = $item;
        }

        return $result;
    }

    private function compute_remaining( ?string $expires_mysql ): string {
        if ( null === $expires_mysql || '' === $expires_mysql ) {
            return __( 'Lifetime', 'epic-license-manager' );
        }
        $diff = ( strtotime( $expires_mysql . ' UTC' ) ?: 0 ) - time();
        if ( $diff <= 0 ) {
            return __( 'Expired', 'epic-license-manager' );
        }
        $days  = intdiv( $diff, DAY_IN_SECONDS );
        $hours = intdiv( $diff % DAY_IN_SECONDS, HOUR_IN_SECONDS );
        return sprintf( __( '%d days %d hours', 'epic-license-manager' ), $days, $hours );
    }

    public function handle_excel_export(): void {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html__( 'Unauthorized.', 'epic-license-manager' ) );
        }
        check_admin_referer( 'elm_export_excel_nonce' );

        $extra = isset( $_GET['extra_columns'] ) && is_array( $_GET['extra_columns'] )
            ? array_map( 'sanitize_key', wp_unslash( $_GET['extra_columns'] ) )
            : [];

        $rows = $this->query_licenses( [
            'app_id'        => isset( $_GET['app_id'] ) ? absint( $_GET['app_id'] ) : 0,
            'status'        => isset( $_GET['status'] ) ? sanitize_key( (string) wp_unslash( $_GET['status'] ) ) : '',
            'search'        => isset( $_GET['search'] ) ? sanitize_text_field( (string) wp_unslash( $_GET['search'] ) ) : '',
            'extra_columns' => $extra,
        ] );

        header( 'Content-Type: text/csv; charset=UTF-8' );
        header( 'Content-Disposition: attachment; filename="epic-licenses-' . gmdate( 'Y-m-d' ) . '.csv"' );
        echo "\xEF\xBB\xBF"; // UTF-8 BOM for clean Persian rendering in Microsoft Excel

        $out = fopen( 'php://output', 'w' );
        if ( false === $out ) {
            exit;
        }
        if ( ! empty( $rows ) ) {
            fputcsv( $out, array_keys( $rows[0] ) );
            foreach ( $rows as $r ) {
                fputcsv( $out, array_values( $r ) );
            }
        }
        fclose( $out );
        exit;
    }
}
`;
}

export function buildAdminPhp(): string {
  return `<?php
/**
 * WordPress Admin Console for Epic License Manager
 * Tabs: Apps & Manifest Importer | Calendar (Gregorian/Jalali/Hijri) | WooCommerce Trigger | Reports
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class ELM_Admin {

    private ELM_Calendar $calendar;
    private ELM_Crypto $crypto;
    private ELM_Reports $reports;

    public function __construct( ELM_Calendar $calendar, ELM_Crypto $crypto, ELM_Reports $reports ) {
        $this->calendar = $calendar;
        $this->crypto   = $crypto;
        $this->reports  = $reports;

        add_action( 'admin_menu', [ $this, 'register_menu' ] );
        add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_assets' ] );
        add_action( 'admin_post_elm_save_settings', [ $this, 'handle_save_settings' ] );
        add_action( 'admin_post_elm_create_app', [ $this, 'handle_create_app' ] );
    }

    public function register_menu(): void {
        add_menu_page(
            __( 'Epic License Manager', 'epic-license-manager' ),
            __( 'Epic Licenses', 'epic-license-manager' ),
            'manage_woocommerce',
            'elm-dashboard',
            [ $this, 'render_page' ],
            'dashicons-shield-alt',
            56
        );
    }

    public function enqueue_assets( string $hook ): void {
        if ( ! str_contains( $hook, 'elm-dashboard' ) ) {
            return;
        }
        wp_enqueue_style( 'elm-admin', ELM_PLUGIN_URL . 'assets/admin.css', [], ELM_VERSION );
        wp_enqueue_script( 'elm-admin', ELM_PLUGIN_URL . 'assets/admin.js', [], ELM_VERSION, true );
    }

    public function handle_save_settings(): void {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html__( 'Unauthorized', 'epic-license-manager' ) );
        }
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
            'trigger_statuses'   => $statuses,
            'block_guest'        => ! empty( $_POST['wc_block_guest'] ),
            'require_first_name' => true,
            'require_last_name'  => true,
            'require_mobile'     => true,
            'require_email'      => true,
        ] );

        wp_safe_redirect( admin_url( 'admin.php?page=elm-dashboard&tab=settings&saved=1' ) );
        exit;
    }

    public function handle_create_app(): void {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html__( 'Unauthorized', 'epic-license-manager' ) );
        }
        check_admin_referer( 'elm_create_app_nonce' );

        global $wpdb;
        $keys = $this->crypto->generate_app_keypair();
        $wpdb->insert(
            $wpdb->prefix . 'elm_apps',
            [
                'app_slug'           => sanitize_key( (string) wp_unslash( $_POST['app_slug'] ?? '' ) ),
                'app_name'           => sanitize_text_field( (string) wp_unslash( $_POST['app_name'] ?? '' ) ),
                'platform'           => sanitize_key( (string) wp_unslash( $_POST['platform'] ?? 'android' ) ),
                'license_mode'       => sanitize_key( (string) wp_unslash( $_POST['license_mode'] ?? 'method2_trial' ) ),
                'trial_days'         => max( 0, absint( $_POST['trial_days'] ?? 14 ) ),
                'offline_grace_days' => max( 1, absint( $_POST['offline_grace_days'] ?? 14 ) ),
                'public_key'         => $keys['public_key'],
                'private_key'        => $keys['private_key'],
                'purchase_url'       => esc_url_raw( (string) wp_unslash( $_POST['purchase_url'] ?? '' ) ),
                'promo_enabled'      => 1,
                'promo_display_mode' => sanitize_key( (string) wp_unslash( $_POST['promo_display_mode'] ?? 'floating_modal' ) ),
                'promo_interval_sec' => max( 15, absint( $_POST['promo_interval_sec'] ?? 180 ) ),
                'promo_html'         => wp_kses_post( (string) wp_unslash( $_POST['promo_html'] ?? '' ) ),
                'created_at'         => gmdate( 'Y-m-d H:i:s' ),
            ]
        );

        wp_safe_redirect( admin_url( 'admin.php?page=elm-dashboard&tab=apps&created=1' ) );
        exit;
    }

    public function render_page(): void {
        $tab = isset( $_GET['tab'] ) ? sanitize_key( (string) wp_unslash( $_GET['tab'] ) ) : 'reports';
        $cal = $this->calendar->get_settings();
        $wc  = get_option( 'elm_wc_settings', [] );

        echo '<div class="wrap elm-wrap">';
        echo '<h1>' . esc_html__( 'Epic License Manager', 'epic-license-manager' ) . '</h1>';
        echo '<nav class="nav-tab-wrapper">';
        $tabs = [
            'reports'  => __( 'License Reports & ACF', 'epic-license-manager' ),
            'apps'     => __( 'Apps & HTML Promos', 'epic-license-manager' ),
            'settings' => __( 'Calendar & WooCommerce', 'epic-license-manager' ),
        ];
        foreach ( $tabs as $k => $label ) {
            $cls = ( $k === $tab ) ? 'nav-tab nav-tab-active' : 'nav-tab';
            echo '<a href="' . esc_url( admin_url( 'admin.php?page=elm-dashboard&tab=' . $k ) ) . '" class="' . esc_attr( $cls ) . '">' . esc_html( $label ) . '</a>';
        }
        echo '</nav>';

        if ( 'settings' === $tab ) {
            $this->render_settings_tab( $cal, is_array( $wc ) ? $wc : [] );
        } elseif ( 'apps' === $tab ) {
            $this->render_apps_tab();
        } else {
            $this->render_reports_tab();
        }
        echo '</div>';
    }

    private function render_settings_tab( array $cal, array $wc ): void {
        $statuses = is_array( $wc['trigger_statuses'] ?? null ) ? $wc['trigger_statuses'] : [ 'completed' ];
        ?>
        <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="elm-card">
            <?php wp_nonce_field( 'elm_save_settings_nonce' ); ?>
            <input type="hidden" name="action" value="elm_save_settings" />
            <h2><?php esc_html_e( 'Independent Calendar Settings (Without Touching Core)', 'epic-license-manager' ); ?></h2>
            <table class="form-table">
                <tr>
                    <th><?php esc_html_e( 'Public Frontend Calendar', 'epic-license-manager' ); ?></th>
                    <td><?php $this->render_cal_select( 'cal_public', $cal['public'] ); ?></td>
                </tr>
                <tr>
                    <th><?php esc_html_e( 'WordPress Admin Calendar', 'epic-license-manager' ); ?></th>
                    <td><?php $this->render_cal_select( 'cal_admin', $cal['admin'] ); ?></td>
                </tr>
                <tr>
                    <th><?php esc_html_e( 'Plugin Interface Calendar', 'epic-license-manager' ); ?></th>
                    <td><?php $this->render_cal_select( 'cal_plugin', $cal['plugin'] ); ?></td>
                </tr>
            </table>
            <h2><?php esc_html_e( 'WooCommerce Order Issuance & Auth Enforcement', 'epic-license-manager' ); ?></h2>
            <p>
                <label>
                    <input type="checkbox" name="wc_block_guest" value="1" <?php checked( ! empty( $wc['block_guest'] ) ); ?> />
                    <?php esc_html_e( 'Disable guest checkout & require First Name, Last Name, Mobile, Email before payment', 'epic-license-manager' ); ?>
                </label>
            </p>
            <p><strong><?php esc_html_e( 'Issue Licenses When Order Reaches:', 'epic-license-manager' ); ?></strong></p>
            <?php foreach ( [ 'completed' => 'Completed', 'processing' => 'Processing', 'on-hold' => 'On Hold' ] as $st => $label ) : ?>
                <label style="margin-inline-end:16px;">
                    <input type="checkbox" name="wc_trigger_statuses[]" value="<?php echo esc_attr( $st ); ?>" <?php checked( in_array( $st, $statuses, true ) ); ?> />
                    <?php echo esc_html( $label ); ?>
                </label>
            <?php endforeach; ?>
            <p class="submit"><button type="submit" class="button button-primary"><?php esc_html_e( 'Save Settings', 'epic-license-manager' ); ?></button></p>
        </form>
        <?php
    }

    private function render_cal_select( string $name, string $current ): void {
        echo '<select name="' . esc_attr( $name ) . '">';
        foreach ( [ 'gregorian' => 'Gregorian (میلادی)', 'jalali' => 'Jalali (شمسی)', 'hijri' => 'Hijri (قمری)' ] as $k => $v ) {
            echo '<option value="' . esc_attr( $k ) . '"' . selected( $current, $k, false ) . '>' . esc_html( $v ) . '</option>';
        }
        echo '</select>';
    }

    private function render_apps_tab(): void {
        global $wpdb;
        $apps = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}elm_apps ORDER BY id DESC" );
        ?>
        <div class="elm-card">
            <h2><?php esc_html_e( 'Register New Application License System', 'epic-license-manager' ); ?></h2>
            <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
                <?php wp_nonce_field( 'elm_create_app_nonce' ); ?>
                <input type="hidden" name="action" value="elm_create_app" />
                <table class="form-table">
                    <tr><th><?php esc_html_e( 'App Name', 'epic-license-manager' ); ?></th><td><input type="text" name="app_name" required class="regular-text" /></td></tr>
                    <tr><th><?php esc_html_e( 'App Slug', 'epic-license-manager' ); ?></th><td><input type="text" name="app_slug" required class="regular-text" placeholder="my-android-app" /></td></tr>
                    <tr><th><?php esc_html_e( 'Licensing Mode', 'epic-license-manager' ); ?></th><td>
                        <select name="license_mode">
                            <option value="method1_gated"><?php esc_html_e( 'Method 1: Feature-Gated Subscription', 'epic-license-manager' ); ?></option>
                            <option value="method2_trial"><?php esc_html_e( 'Method 2: Anti-Reinstall Trial + Gated Subscription', 'epic-license-manager' ); ?></option>
                        </select>
                    </td></tr>
                    <tr><th><?php esc_html_e( 'Trial Days / Offline Grace Days', 'epic-license-manager' ); ?></th><td><input type="number" name="trial_days" value="14" min="0" /> / <input type="number" name="offline_grace_days" value="14" min="1" /></td></tr>
                    <tr><th><?php esc_html_e( 'WooCommerce Purchase URL', 'epic-license-manager' ); ?></th><td><input type="url" name="purchase_url" class="regular-text" placeholder="https://yektap.ir/product/pro-license" /></td></tr>
                    <tr><th><?php esc_html_e( 'Mobile Promo HTML', 'epic-license-manager' ); ?></th><td><textarea name="promo_html" rows="4" class="large-text"></textarea></td></tr>
                </table>
                <p class="submit"><button type="submit" class="button button-primary"><?php esc_html_e( 'Create App & Generate Ed25519 Keys', 'epic-license-manager' ); ?></button></p>
            </form>
        </div>
        <div class="elm-card">
            <h2><?php esc_html_e( 'Registered Applications', 'epic-license-manager' ); ?></h2>
            <table class="widefat striped">
                <thead><tr><th>Slug</th><th>Name</th><th>Mode</th><th>Public Key (Embed in App)</th></tr></thead>
                <tbody>
                <?php if ( is_array( $apps ) ) : foreach ( $apps as $app ) : ?>
                    <tr>
                        <td><code><?php echo esc_html( (string) $app->app_slug ); ?></code></td>
                        <td><?php echo esc_html( (string) $app->app_name ); ?></td>
                        <td><?php echo esc_html( (string) $app->license_mode ); ?></td>
                        <td><code><?php echo esc_html( substr( (string) $app->public_key, 0, 44 ) ); ?>...</code></td>
                    </tr>
                <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }

    private function render_reports_tab(): void {
        $extra_defs    = $this->reports->get_available_extra_columns();
        $selected_cols = isset( $_GET['extra_columns'] ) && is_array( $_GET['extra_columns'] )
            ? array_map( 'sanitize_key', wp_unslash( $_GET['extra_columns'] ) )
            : [];
        $rows = $this->reports->query_licenses( [ 'extra_columns' => $selected_cols ] );
        ?>
        <div class="elm-card">
            <h2><?php esc_html_e( 'License Sales & Customer Report (WP + WooCommerce + ACF Fields)', 'epic-license-manager' ); ?></h2>
            <form method="get">
                <input type="hidden" name="page" value="elm-dashboard" />
                <input type="hidden" name="tab" value="reports" />
                <p><?php esc_html_e( 'Include extra customer fields:', 'epic-license-manager' ); ?></p>
                <?php foreach ( $extra_defs as $key => $meta ) : ?>
                    <label style="margin-inline-end:14px;">
                        <input type="checkbox" name="extra_columns[]" value="<?php echo esc_attr( $key ); ?>" <?php checked( in_array( $key, $selected_cols, true ) ); ?> />
                        <?php echo esc_html( $meta['label'] ); ?>
                    </label>
                <?php endforeach; ?>
                <p>
                    <button type="submit" class="button"><?php esc_html_e( 'Apply Columns', 'epic-license-manager' ); ?></button>
                    <a href="<?php echo esc_url( wp_nonce_url( add_query_arg( [ 'action' => 'elm_export_excel', 'extra_columns' => $selected_cols ], admin_url( 'admin-post.php' ) ), 'elm_export_excel_nonce' ) ); ?>" class="button button-primary">
                        <?php esc_html_e( 'Export Excel (UTF-8 CSV)', 'epic-license-manager' ); ?>
                    </a>
                </p>
            </form>
            <table class="widefat striped">
                <thead><tr>
                    <th><?php esc_html_e( 'License Key', 'epic-license-manager' ); ?></th>
                    <th><?php esc_html_e( 'App', 'epic-license-manager' ); ?></th>
                    <th><?php esc_html_e( 'Customer', 'epic-license-manager' ); ?></th>
                    <th><?php esc_html_e( 'Mobile', 'epic-license-manager' ); ?></th>
                    <th><?php esc_html_e( 'Email', 'epic-license-manager' ); ?></th>
                    <th><?php esc_html_e( 'Remaining', 'epic-license-manager' ); ?></th>
                    <?php foreach ( $selected_cols as $ck ) : ?>
                        <th><?php echo esc_html( $extra_defs[ $ck ]['label'] ?? $ck ); ?></th>
                    <?php endforeach; ?>
                </tr></thead>
                <tbody>
                <?php foreach ( $rows as $r ) : ?>
                    <tr>
                        <td><code><?php echo esc_html( (string) $r['license_key'] ); ?></code></td>
                        <td><?php echo esc_html( (string) $r['app_name'] ); ?></td>
                        <td><?php echo esc_html( (string) $r['customer_name'] ); ?></td>
                        <td><?php echo esc_html( (string) $r['customer_mobile'] ); ?></td>
                        <td><?php echo esc_html( (string) $r['customer_email'] ); ?></td>
                        <td><?php echo esc_html( (string) $r['remaining'] ); ?></td>
                        <?php foreach ( $selected_cols as $ck ) : ?>
                            <td><?php echo esc_html( (string) ( $r[ $ck ] ?? '—' ) ); ?></td>
                        <?php endforeach; ?>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
        <?php
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
  const adminCss = `.elm-wrap .elm-card {
  background: #ffffff;
  border: 1px solid #dcdcde;
  border-radius: 6px;
  padding: 20px;
  margin-top: 16px;
}
.elm-variation-box {
  border-top: 1px solid #eee;
  margin-top: 10px;
  padding-top: 10px;
}
`;

  const adminJs = `document.addEventListener('DOMContentLoaded', () => {
  // Placeholder for admin enhancements
});
`;

  const potFile = `msgid ""
msgstr ""
"Project-Id-Version: Epic License Manager 1.0.0\\n"
"POT-Creation-Date: 2026-11-26 12:00+0000\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"X-Domain: epic-license-manager\\n"

msgid "Epic License Manager"
msgstr ""

msgid "My Licenses"
msgstr ""

msgid "Your Software License Keys"
msgstr ""

msgid "You must sign in or create an account with your full name, mobile number, and email before payment."
msgstr ""
`;

  const faPoFile = `msgid ""
msgstr ""
"Project-Id-Version: Epic License Manager 1.0.0\\n"
"Language: fa_IR\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"X-Domain: epic-license-manager\\n"

msgid "Epic License Manager"
msgstr "مدیریت لایسنس اپیک"

msgid "My Licenses"
msgstr "لایسنس‌های من"

msgid "Your Software License Keys"
msgstr "کلیدهای لایسنس نرم‌افزار شما"

msgid "You must sign in or create an account with your full name, mobile number, and email before payment."
msgstr "پیش از پرداخت، ورود یا ثبت‌نام با نام، نام خانوادگی، شماره موبایل و ایمیل الزامی است."
`;

  const aiBlueprintMd = `# Epic License Manager — AI Studio & Developer Integration Blueprint

## 1. AI Assistant Interactive Discovery Protocol (Ask Before Generating Code)
When a developer asks Google AI Studio (or another AI) to integrate Epic License Manager into an Android (Kotlin/Gradle) or Web (React/Node.js) project, the AI MUST first ask these 5 project-specific questions:
1. Licensing Mode: Method 1 (Feature-gated from first launch) or Method 2 (Full Trial first, then feature-gated)?
2. Restricted Modules: Which specific screens/features lock when unlicensed or after trial expiry?
3. Trial & Offline Grace Window: How many Trial days (e.g. 10, 30, 90) and how many offline grace days (e.g. 7 or 14) before periodic background sync?
4. Store Endpoint & Purchase URL: What is the WordPress REST base URL (e.g. https://yektap.ir/wp-json/elm/v1) and WooCommerce variable product URL?
5. Promo HTML Display Trigger: Should the server HTML offer appear as a floating dialog every N seconds, or on clicking a locked module?

## 2. Standard REST Contract
- POST /wp-json/elm/v1/app/handshake
- POST /wp-json/elm/v1/trial/activate
- POST /wp-json/elm/v1/license/activate
- POST /wp-json/elm/v1/license/verify
- GET  /wp-json/elm/v1/promo?app_slug={slug}
`;

  return { adminCss, adminJs, potFile, faPoFile, aiBlueprintMd };
}
