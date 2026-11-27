export function buildWooCommercePhp(): string {
  return `<?php
/**
 * WooCommerce Integration (HPOS Compatible):
 * - Enforces registration/login before checkout (First Name, Last Name, Mobile, Email)
 * - Maps Simple & Variable Products to App Packages (1 to 10 License Keys per variation)
 * - Issues licenses strictly on configured WooCommerce Order Status transitions
 * - Displays keys inside Order Details, Emails, and My Account -> Licenses
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class ELM_WooCommerce {

    private ELM_Crypto $crypto;

    public function __construct( ELM_Crypto $crypto ) {
        $this->crypto = $crypto;

        // 1. Mandatory registration & required customer identity fields before payment
        add_filter( 'pre_option_woocommerce_enable_guest_checkout', [ $this, 'disable_guest_checkout' ] );
        add_filter( 'woocommerce_checkout_registration_required', '__return_true' );
        add_filter( 'woocommerce_checkout_fields', [ $this, 'enforce_required_checkout_fields' ], 20 );
        add_action( 'woocommerce_checkout_process', [ $this, 'validate_checkout_identity' ] );

        // 2. Variable Product Bundle Mapping (1-10 licenses per variation)
        add_action( 'woocommerce_product_after_variable_attributes', [ $this, 'render_variation_fields' ], 10, 3 );
        add_action( 'woocommerce_save_product_variation', [ $this, 'save_variation_fields' ], 10, 2 );

        // 3. Simple Product Mapping Tab
        add_filter( 'woocommerce_product_data_tabs', [ $this, 'add_product_data_tab' ] );
        add_action( 'woocommerce_product_data_panels', [ $this, 'render_product_data_panel' ] );
        add_action( 'woocommerce_process_product_meta', [ $this, 'save_simple_product_fields' ] );

        // 4. Order Status Hook (gateway-agnostic, HPOS-safe)
        add_action( 'woocommerce_order_status_changed', [ $this, 'handle_order_status_changed' ], 10, 4 );

        // 5. Display licenses on Order Details, Emails, and My Account
        add_action( 'woocommerce_order_details_after_order_table', [ $this, 'render_order_licenses' ] );
        add_action( 'woocommerce_email_after_order_table', [ $this, 'render_order_licenses' ], 10, 1 );
        add_action( 'init', [ $this, 'register_my_account_endpoint' ] );
        add_filter( 'woocommerce_account_menu_items', [ $this, 'add_my_account_menu_item' ] );
        add_action( 'woocommerce_account_elm-licenses_endpoint', [ $this, 'render_my_account_licenses' ] );
    }

    public function disable_guest_checkout( mixed $value ): string {
        $settings = get_option( 'elm_wc_settings', [] );
        if ( ! empty( $settings['block_guest'] ) ) {
            return 'no';
        }
        return is_string( $value ) ? $value : 'no';
    }

    /**
     * @param array<string, array<string, mixed>> $fields
     * @return array<string, array<string, mixed>>
     */
    public function enforce_required_checkout_fields( array $fields ): array {
        $required_billing = [
            'billing_first_name' => __( 'First Name', 'epic-license-manager' ),
            'billing_last_name'  => __( 'Last Name', 'epic-license-manager' ),
            'billing_phone'      => __( 'Mobile Phone', 'epic-license-manager' ),
            'billing_email'      => __( 'Email Address', 'epic-license-manager' ),
        ];
        foreach ( $required_billing as $key => $label ) {
            if ( isset( $fields['billing'][ $key ] ) ) {
                $fields['billing'][ $key ]['required'] = true;
                $fields['billing'][ $key ]['label']    = $label;
            }
        }
        return $fields;
    }

    public function validate_checkout_identity(): void {
        if ( ! is_user_logged_in() && empty( $_POST['createaccount'] ) ) {
            wc_add_notice(
                __( 'You must sign in or create an account with your full name, mobile number, and email before payment.', 'epic-license-manager' ),
                'error'
            );
        }
        $phone = isset( $_POST['billing_phone'] ) ? sanitize_text_field( (string) wp_unslash( $_POST['billing_phone'] ) ) : '';
        if ( strlen( preg_replace( '/[^0-9]/', '', $phone ) ?? '' ) < 10 ) {
            wc_add_notice(
                __( 'Please enter a valid mobile phone number.', 'epic-license-manager' ),
                'error'
            );
        }
    }

    public function render_variation_fields( int $loop, array $variation_data, \\WP_Post $variation ): void {
        global $wpdb;
        $apps = $wpdb->get_results( "SELECT id, app_name, app_slug FROM {$wpdb->prefix}elm_apps ORDER BY app_name ASC" );

        $app_options = [ '' => __( '— Not Linked —', 'epic-license-manager' ) ];
        if ( is_array( $apps ) ) {
            foreach ( $apps as $app ) {
                $app_options[ (string) $app->id ] = $app->app_name . ' (' . $app->app_slug . ')';
            }
        }

        echo '<div class="elm-variation-box options_group">';
        woocommerce_wp_select( [
            'id'      => "_elm_app_id[{$loop}]",
            'label'   => __( 'Epic License App', 'epic-license-manager' ),
            'value'   => get_post_meta( $variation->ID, '_elm_app_id', true ),
            'options' => $app_options,
        ] );

        woocommerce_wp_select( [
            'id'      => "_elm_duration[{$loop}]",
            'label'   => __( 'License Duration', 'epic-license-manager' ),
            'value'   => get_post_meta( $variation->ID, '_elm_duration', true ) ?: '1m',
            'options' => [
                '1m'       => __( '1 Month', 'epic-license-manager' ),
                '3m'       => __( '3 Months', 'epic-license-manager' ),
                '1y'       => __( '1 Year', 'epic-license-manager' ),
                'lifetime' => __( 'Lifetime', 'epic-license-manager' ),
            ],
        ] );

        woocommerce_wp_text_input( [
            'id'                => "_elm_license_qty[{$loop}]",
            'label'             => __( 'License Keys Issued (1 - 10)', 'epic-license-manager' ),
            'type'              => 'number',
            'value'             => get_post_meta( $variation->ID, '_elm_license_qty', true ) ?: '1',
            'custom_attributes' => [ 'min' => '1', 'max' => '10', 'step' => '1' ],
            'desc_tip'          => true,
            'description'       => __( 'Number of separate license keys issued when this variation is purchased (supports bundle pricing in WooCommerce).', 'epic-license-manager' ),
        ] );
        echo '</div>';
    }

    public function save_variation_fields( int $variation_id, int $loop ): void {
        if ( isset( $_POST['_elm_app_id'][ $loop ] ) ) {
            update_post_meta( $variation_id, '_elm_app_id', absint( wp_unslash( $_POST['_elm_app_id'][ $loop ] ) ) );
        }
        if ( isset( $_POST['_elm_duration'][ $loop ] ) ) {
            $dur = sanitize_key( (string) wp_unslash( $_POST['_elm_duration'][ $loop ] ) );
            if ( in_array( $dur, [ '1m', '3m', '1y', 'lifetime' ], true ) ) {
                update_post_meta( $variation_id, '_elm_duration', $dur );
            }
        }
        if ( isset( $_POST['_elm_license_qty'][ $loop ] ) ) {
            $qty = max( 1, min( 10, absint( wp_unslash( $_POST['_elm_license_qty'][ $loop ] ) ) ) );
            update_post_meta( $variation_id, '_elm_license_qty', $qty );
        }
    }

    /**
     * @param array<string, array<string, mixed>> $tabs
     * @return array<string, array<string, mixed>>
     */
    public function add_product_data_tab( array $tabs ): array {
        $tabs['elm_license'] = [
            'label'  => __( 'Epic License', 'epic-license-manager' ),
            'target' => 'elm_license_product_data',
            'class'  => [ 'show_if_simple' ],
        ];
        return $tabs;
    }

    public function render_product_data_panel(): void {
        global $wpdb, $post;
        $apps = $wpdb->get_results( "SELECT id, app_name, app_slug FROM {$wpdb->prefix}elm_apps ORDER BY app_name ASC" );
        $app_options = [ '' => __( '— Not Linked —', 'epic-license-manager' ) ];
        if ( is_array( $apps ) ) {
            foreach ( $apps as $app ) {
                $app_options[ (string) $app->id ] = $app->app_name . ' (' . $app->app_slug . ')';
            }
        }

        echo '<div id="elm_license_product_data" class="panel woocommerce_options_panel">';
        woocommerce_wp_select( [
            'id'      => '_elm_app_id',
            'label'   => __( 'Epic License App', 'epic-license-manager' ),
            'options' => $app_options,
        ] );
        woocommerce_wp_select( [
            'id'      => '_elm_duration',
            'label'   => __( 'License Duration', 'epic-license-manager' ),
            'options' => [
                '1m'       => __( '1 Month', 'epic-license-manager' ),
                '3m'       => __( '3 Months', 'epic-license-manager' ),
                '1y'       => __( '1 Year', 'epic-license-manager' ),
                'lifetime' => __( 'Lifetime', 'epic-license-manager' ),
            ],
        ] );
        woocommerce_wp_text_input( [
            'id'                => '_elm_license_qty',
            'label'             => __( 'License Keys Issued (1 - 10)', 'epic-license-manager' ),
            'type'              => 'number',
            'custom_attributes' => [ 'min' => '1', 'max' => '10', 'step' => '1' ],
        ] );
        echo '</div>';
    }

    public function save_simple_product_fields( int $post_id ): void {
        if ( isset( $_POST['_elm_app_id'] ) ) {
            update_post_meta( $post_id, '_elm_app_id', absint( wp_unslash( $_POST['_elm_app_id'] ) ) );
        }
        if ( isset( $_POST['_elm_duration'] ) ) {
            update_post_meta( $post_id, '_elm_duration', sanitize_key( (string) wp_unslash( $_POST['_elm_duration'] ) ) );
        }
        if ( isset( $_POST['_elm_license_qty'] ) ) {
            update_post_meta( $post_id, '_elm_license_qty', max( 1, min( 10, absint( wp_unslash( $_POST['_elm_license_qty'] ) ) ) ) );
        }
    }

    public function handle_order_status_changed( int $order_id, string $old_status, string $new_status, \\WC_Order $order ): void {
        $settings         = get_option( 'elm_wc_settings', [] );
        $trigger_statuses = is_array( $settings['trigger_statuses'] ?? null ) ? $settings['trigger_statuses'] : [ 'completed' ];

        if ( ! in_array( $new_status, $trigger_statuses, true ) ) {
            return;
        }

        // Prevent duplicate issuance on repeated status transitions (HPOS-safe meta)
        if ( 'yes' === $order->get_meta( '_elm_licenses_issued', true ) ) {
            return;
        }

        global $wpdb;
        $licenses_table = $wpdb->prefix . 'elm_licenses';
        $issued_keys    = [];
        $now_mysql      = gmdate( 'Y-m-d H:i:s' );
        $user_id        = (int) $order->get_user_id();

        foreach ( $order->get_items() as $item ) {
            if ( ! $item instanceof \\WC_Order_Item_Product ) {
                continue;
            }
            $target_id = $item->get_variation_id() ?: $item->get_product_id();
            $app_id    = (int) get_post_meta( $target_id, '_elm_app_id', true );
            if ( $app_id <= 0 ) {
                continue;
            }
            $duration   = (string) ( get_post_meta( $target_id, '_elm_duration', true ) ?: '1m' );
            $per_unit   = max( 1, min( 10, (int) ( get_post_meta( $target_id, '_elm_license_qty', true ) ?: 1 ) ) );
            $total_keys = $per_unit * max( 1, (int) $item->get_quantity() );

            for ( $i = 0; $i < $total_keys; $i++ ) {
                $key = $this->crypto->generate_license_key( 'ELM' );
                $wpdb->insert(
                    $licenses_table,
                    [
                        'license_key'     => $key,
                        'app_id'          => $app_id,
                        'order_id'        => $order_id,
                        'user_id'         => $user_id,
                        'duration_type'   => $duration,
                        'max_activations' => 1,
                        'status'          => 'active',
                        'issued_at'       => $now_mysql,
                        'expires_at'      => null, // Starts counting on first device activation or fixed on sync
                    ],
                    [ '%s', '%d', '%d', '%d', '%s', '%d', '%s', '%s', '%s' ]
                );
                $issued_keys[] = $key;
            }
        }

        if ( ! empty( $issued_keys ) ) {
            $order->update_meta_data( '_elm_licenses_issued', 'yes' );
            $order->update_meta_data( '_elm_license_keys', $issued_keys );
            $order->save();
        }
    }

    public function render_order_licenses( \\WC_Order $order ): void {
        $keys = $order->get_meta( '_elm_license_keys', true );
        if ( empty( $keys ) || ! is_array( $keys ) ) {
            return;
        }
        echo '<section class="elm-order-licenses"><h2>' . esc_html__( 'Your Software License Keys', 'epic-license-manager' ) . '</h2><ul>';
        foreach ( $keys as $key ) {
            echo '<li><code>' . esc_html( (string) $key ) . '</code></li>';
        }
        echo '</ul></section>';
    }

    public function register_my_account_endpoint(): void {
        add_rewrite_endpoint( 'elm-licenses', EP_ROOT | EP_PAGES );
    }

    /**
     * @param array<string, string> $items
     * @return array<string, string>
     */
    public function add_my_account_menu_item( array $items ): array {
        $items['elm-licenses'] = __( 'My Licenses', 'epic-license-manager' );
        return $items;
    }

    public function render_my_account_licenses(): void {
        $user_id = get_current_user_id();
        if ( $user_id <= 0 ) {
            return;
        }
        global $wpdb;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT l.*, a.app_name FROM {$wpdb->prefix}elm_licenses l
                 INNER JOIN {$wpdb->prefix}elm_apps a ON a.id = l.app_id
                 WHERE l.user_id = %d ORDER BY l.id DESC",
                $user_id
            )
        );
        echo '<h3>' . esc_html__( 'Active & Purchased Licenses', 'epic-license-manager' ) . '</h3>';
        if ( empty( $rows ) ) {
            echo '<p>' . esc_html__( 'No licenses found for your account.', 'epic-license-manager' ) . '</p>';
            return;
        }
        echo '<table class="shop_table shop_table_responsive"><thead><tr>';
        echo '<th>' . esc_html__( 'Application', 'epic-license-manager' ) . '</th>';
        echo '<th>' . esc_html__( 'License Key', 'epic-license-manager' ) . '</th>';
        echo '<th>' . esc_html__( 'Duration', 'epic-license-manager' ) . '</th>';
        echo '<th>' . esc_html__( 'Status', 'epic-license-manager' ) . '</th>';
        echo '</tr></thead><tbody>';
        foreach ( $rows as $row ) {
            echo '<tr>';
            echo '<td>' . esc_html( (string) $row->app_name ) . '</td>';
            echo '<td><code>' . esc_html( (string) $row->license_key ) . '</code></td>';
            echo '<td>' . esc_html( (string) $row->duration_type ) . '</td>';
            echo '<td>' . esc_html( (string) $row->status ) . '</td>';
            echo '</tr>';
        }
        echo '</tbody></table>';
    }
}
`;
}

export function buildRestApiPhp(): string {
  return `<?php
/**
 * REST API Endpoints for Android (Kotlin) & Web (React/Node.js) Applications
 * Namespace: /wp-json/elm/v1/
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class ELM_Rest_API {

    private ELM_Crypto $crypto;

    public function __construct( ELM_Crypto $crypto ) {
        $this->crypto = $crypto;
        add_action( 'rest_api_init', [ $this, 'register_routes' ] );
    }

    public function register_routes(): void {
        register_rest_route( 'elm/v1', '/app/handshake', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'handle_handshake' ],
            'permission_callback' => '__return_true',
        ] );

        register_rest_route( 'elm/v1', '/trial/activate', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'handle_trial_activate' ],
            'permission_callback' => '__return_true',
        ] );

        register_rest_route( 'elm/v1', '/license/activate', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'handle_license_activate' ],
            'permission_callback' => '__return_true',
        ] );

        register_rest_route( 'elm/v1', '/license/verify', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'handle_license_verify' ],
            'permission_callback' => '__return_true',
        ] );

        register_rest_route( 'elm/v1', '/promo', [
            'methods'             => 'GET',
            'callback'            => [ $this, 'handle_get_promo' ],
            'permission_callback' => '__return_true',
        ] );
    }

    public function handle_handshake( \\WP_REST_Request $request ): \\WP_REST_Response {
        $slug = sanitize_key( (string) $request->get_param( 'app_slug' ) );
        global $wpdb;
        $app = $wpdb->get_row(
            $wpdb->prepare( "SELECT id, app_slug, app_name, license_mode, trial_days, offline_grace_days, public_key, purchase_url FROM {$wpdb->prefix}elm_apps WHERE app_slug = %s", $slug )
        );
        if ( ! $app ) {
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'app_not_found' ], 404 );
        }
        return new \\WP_REST_Response( [
            'ok'                 => true,
            'app_slug'           => $app->app_slug,
            'app_name'           => $app->app_name,
            'license_mode'       => $app->license_mode,
            'trial_days'         => (int) $app->trial_days,
            'offline_grace_days' => (int) $app->offline_grace_days,
            'public_key'         => $app->public_key,
            'purchase_url'       => $app->purchase_url,
            'server_time_utc'    => gmdate( 'c' ),
        ], 200 );
    }

    public function handle_trial_activate( \\WP_REST_Request $request ): \\WP_REST_Response {
        global $wpdb;
        $slug          = sanitize_key( (string) $request->get_param( 'app_slug' ) );
        $hardware_hash = sanitize_text_field( (string) $request->get_param( 'hardware_hash' ) );
        $device_model  = sanitize_text_field( (string) $request->get_param( 'device_model' ) );
        $os_version    = sanitize_text_field( (string) $request->get_param( 'os_version' ) );

        if ( '' === $slug || strlen( $hardware_hash ) < 16 ) {
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'invalid_hardware_fingerprint' ], 400 );
        }

        $app = $wpdb->get_row(
            $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}elm_apps WHERE app_slug = %s", $slug )
        );
        if ( ! $app ) {
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'app_not_found' ], 404 );
        }

        $act_table = $wpdb->prefix . 'elm_activations';
        $existing  = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT * FROM {$act_table} WHERE app_id = %d AND hardware_hash = %s AND is_trial = 1",
                (int) $app->id,
                $hardware_hash
            )
        );

        $now_ts = time();
        if ( $existing ) {
            $wpdb->update(
                $act_table,
                [
                    'reinstall_attempts' => (int) $existing->reinstall_attempts + 1,
                    'last_seen_at'       => gmdate( 'Y-m-d H:i:s', $now_ts ),
                ],
                [ 'id' => (int) $existing->id ],
                [ '%d', '%s' ],
                [ '%d' ]
            );
            $exp_ts = strtotime( (string) $existing->trial_expires_at . ' UTC' ) ?: 0;
            if ( $exp_ts <= $now_ts ) {
                return new \\WP_REST_Response( [
                    'ok'           => false,
                    'error'        => 'trial_already_used_and_expired',
                    'message'      => __( 'Free trial already consumed on this device. Reinstalling does not reset the trial.', 'epic-license-manager' ),
                    'purchase_url' => $app->purchase_url,
                ], 403 );
            }
            $expires_iso = gmdate( 'c', $exp_ts );
        } else {
            $days        = max( 1, (int) $app->trial_days );
            $exp_ts      = $now_ts + ( $days * DAY_IN_SECONDS );
            $expires_iso = gmdate( 'c', $exp_ts );

            $wpdb->insert(
                $act_table,
                [
                    'app_id'           => (int) $app->id,
                    'license_id'       => null,
                    'hardware_hash'    => $hardware_hash,
                    'device_model'     => $device_model,
                    'os_version'       => $os_version,
                    'is_trial'         => 1,
                    'trial_started_at' => gmdate( 'Y-m-d H:i:s', $now_ts ),
                    'trial_expires_at' => gmdate( 'Y-m-d H:i:s', $exp_ts ),
                    'last_seen_at'     => gmdate( 'Y-m-d H:i:s', $now_ts ),
                    'client_last_clock'=> $now_ts,
                ]
            );
        }

        $payload = [
            'type'               => 'trial',
            'app_slug'           => $app->app_slug,
            'hardware_hash'      => $hardware_hash,
            'issued_at_utc'      => gmdate( 'c', $now_ts ),
            'expires_at_utc'     => $expires_iso,
            'server_time_utc'    => gmdate( 'c', $now_ts ),
            'offline_grace_days' => (int) $app->offline_grace_days,
        ];

        return new \\WP_REST_Response( [
            'ok'           => true,
            'token'        => $this->crypto->sign_token( $payload, (string) $app->private_key ),
            'payload'      => $payload,
            'purchase_url' => $app->purchase_url,
        ], 200 );
    }

    public function handle_license_activate( \\WP_REST_Request $request ): \\WP_REST_Response {
        global $wpdb;
        $slug          = sanitize_key( (string) $request->get_param( 'app_slug' ) );
        $license_key   = strtoupper( sanitize_text_field( (string) $request->get_param( 'license_key' ) ) );
        $hardware_hash = sanitize_text_field( (string) $request->get_param( 'hardware_hash' ) );
        $device_model  = sanitize_text_field( (string) $request->get_param( 'device_model' ) );

        $app = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}elm_apps WHERE app_slug = %s", $slug ) );
        if ( ! $app ) {
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'app_not_found' ], 404 );
        }

        $lic = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT * FROM {$wpdb->prefix}elm_licenses WHERE license_key = %s AND app_id = %d",
                $license_key,
                (int) $app->id
            )
        );
        if ( ! $lic || 'revoked' === $lic->status ) {
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'invalid_or_revoked_license' ], 403 );
        }

        $now_ts = time();
        if ( empty( $lic->expires_at ) && 'lifetime' !== $lic->duration_type ) {
            $days = match ( $lic->duration_type ) {
                '1m'    => 30,
                '3m'    => 90,
                '1y'    => 365,
                default => 30,
            };
            $exp_mysql = gmdate( 'Y-m-d H:i:s', $now_ts + ( $days * DAY_IN_SECONDS ) );
            $wpdb->update(
                $wpdb->prefix . 'elm_licenses',
                [ 'expires_at' => $exp_mysql, 'last_sync_at' => gmdate( 'Y-m-d H:i:s', $now_ts ) ],
                [ 'id' => (int) $lic->id ]
            );
            $expires_iso = gmdate( 'c', $now_ts + ( $days * DAY_IN_SECONDS ) );
        } else {
            $expires_iso = empty( $lic->expires_at ) ? null : gmdate( 'c', strtotime( (string) $lic->expires_at . ' UTC' ) ?: $now_ts );
        }

        $payload = [
            'type'               => 'license',
            'license_key'        => $lic->license_key,
            'duration'           => $lic->duration_type,
            'app_slug'           => $app->app_slug,
            'hardware_hash'      => $hardware_hash,
            'device_model'       => $device_model,
            'issued_at_utc'      => gmdate( 'c', $now_ts ),
            'expires_at_utc'     => $expires_iso,
            'server_time_utc'    => gmdate( 'c', $now_ts ),
            'offline_grace_days' => (int) $app->offline_grace_days,
        ];

        $token = $this->crypto->sign_token( $payload, (string) $app->private_key );
        $wpdb->update( $wpdb->prefix . 'elm_licenses', [ 'signed_token' => $token ], [ 'id' => (int) $lic->id ] );

        return new \\WP_REST_Response( [
            'ok'      => true,
            'token'   => $token,
            'payload' => $payload,
        ], 200 );
    }

    public function handle_license_verify( \\WP_REST_Request $request ): \\WP_REST_Response {
        global $wpdb;
        $slug          = sanitize_key( (string) $request->get_param( 'app_slug' ) );
        $license_key   = strtoupper( sanitize_text_field( (string) $request->get_param( 'license_key' ) ) );
        $hardware_hash = sanitize_text_field( (string) $request->get_param( 'hardware_hash' ) );

        $app = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}elm_apps WHERE app_slug = %s", $slug ) );
        $lic = $app ? $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}elm_licenses WHERE license_key = %s AND app_id = %d", $license_key, (int) $app->id ) ) : null;

        if ( ! $app || ! $lic || 'active' !== $lic->status ) {
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'license_inactive' ], 403 );
        }

        $now_ts      = time();
        $expires_iso = empty( $lic->expires_at ) ? null : gmdate( 'c', strtotime( (string) $lic->expires_at . ' UTC' ) ?: 0 );
        if ( null !== $expires_iso && strtotime( $expires_iso ) <= $now_ts ) {
            $wpdb->update( $wpdb->prefix . 'elm_licenses', [ 'status' => 'expired' ], [ 'id' => (int) $lic->id ] );
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'license_expired', 'purchase_url' => $app->purchase_url ], 403 );
        }

        $payload = [
            'type'               => 'license',
            'license_key'        => $lic->license_key,
            'duration'           => $lic->duration_type,
            'app_slug'           => $app->app_slug,
            'hardware_hash'      => $hardware_hash,
            'issued_at_utc'      => gmdate( 'c', $now_ts ),
            'expires_at_utc'     => $expires_iso,
            'server_time_utc'    => gmdate( 'c', $now_ts ),
            'offline_grace_days' => (int) $app->offline_grace_days,
        ];

        $token = $this->crypto->sign_token( $payload, (string) $app->private_key );
        $wpdb->update(
            $wpdb->prefix . 'elm_licenses',
            [ 'last_sync_at' => gmdate( 'Y-m-d H:i:s', $now_ts ), 'signed_token' => $token ],
            [ 'id' => (int) $lic->id ]
        );

        return new \\WP_REST_Response( [
            'ok'      => true,
            'token'   => $token,
            'payload' => $payload,
        ], 200 );
    }

    public function handle_get_promo( \\WP_REST_Request $request ): \\WP_REST_Response {
        global $wpdb;
        $slug = sanitize_key( (string) $request->get_param( 'app_slug' ) );
        $app  = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}elm_apps WHERE app_slug = %s", $slug ) );
        if ( ! $app ) {
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'app_not_found' ], 404 );
        }
        return new \\WP_REST_Response( [
            'ok'               => true,
            'promo_enabled'    => (bool) $app->promo_enabled,
            'display_mode'     => $app->promo_display_mode,
            'interval_seconds' => (int) $app->promo_interval_sec,
            'purchase_url'     => $app->purchase_url,
            'html'             => wp_kses_post( (string) $app->promo_html ),
        ], 200 );
    }
}
`;
}
