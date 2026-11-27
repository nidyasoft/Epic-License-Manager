export function buildPromoCptPhp(): string {
  return `<?php
/**
 * Custom Post Type for Mobile HTML Promos ('elm_promo')
 * - Provides a dedicated unique link (/?elm_promo={slug} or /elm-promo/{slug}/)
 * - Serves a lightweight distraction-free HTML view without theme header/footer
 * - Includes JS/Android WebView close bridge & direct WooCommerce purchase/cart links
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class ELM_Promo_CPT {

    public function __construct() {
        add_action( 'init', [ $this, 'register_cpt' ] );
        add_filter( 'template_include', [ $this, 'serve_lightweight_template' ], 99 );
    }

    public function register_cpt(): void {
        register_post_type( 'elm_promo', [
            'labels' => [
                'name'          => __( 'Mobile Promos', 'epic-license-manager' ),
                'singular_name' => __( 'Mobile Promo', 'epic-license-manager' ),
            ],
            'public'              => true,
            'exclude_from_search' => true,
            'publicly_queryable'  => true,
            'show_ui'             => true,
            'show_in_menu'        => 'elm-dashboard',
            'rewrite'             => [ 'slug' => 'elm-promo', 'with_front' => false ],
            'supports'            => [ 'title', 'editor' ],
        ] );
    }

    public function serve_lightweight_template( string $template ): string {
        if ( ! is_singular( 'elm_promo' ) ) {
            return $template;
        }
        $post = get_queried_object();
        if ( ! $post instanceof \\WP_Post ) {
            return $template;
        }

        $cta_url   = (string) get_post_meta( $post->ID, '_elm_promo_cta_url', true );
        $cta_label = (string) ( get_post_meta( $post->ID, '_elm_promo_cta_label', true ) ?: __( 'Upgrade & Purchase License', 'epic-license-manager' ) );
        $theme_hex = (string) ( get_post_meta( $post->ID, '_elm_promo_theme', true ) ?: '#0f4c81' );

        status_header( 200 );
        header( 'Content-Type: text/html; charset=utf-8' );
        ?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo( 'charset' ); ?>" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title><?php echo esc_html( get_the_title( $post ) ); ?></title>
  <style>
    body { margin: 0; padding: 16px; background: #f8fafc; font-family: system-ui, -apple-system, Tahoma, sans-serif; color: #0f172a; }
    .elm-mobile-card { max-width: 480px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; box-shadow: 0 8px 24px rgba(15,23,42,.08); }
    .elm-cta-btn { display: block; width: 100%; box-sizing: border-box; text-align: center; background: <?php echo esc_attr( $theme_hex ); ?>; color: #fff; text-decoration: none; font-weight: 600; padding: 12px 16px; border-radius: 10px; margin-top: 16px; }
    .elm-close-btn { display: block; width: 100%; background: transparent; border: 0; color: #64748b; font-size: 13px; padding: 10px; margin-top: 6px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="elm-mobile-card">
    <?php echo wp_kses_post( $post->post_content ); ?>
    <?php if ( '' !== $cta_url ) : ?>
      <a href="<?php echo esc_url( $cta_url ); ?>" class="elm-cta-btn"><?php echo esc_html( $cta_label ); ?></a>
    <?php endif; ?>
    <button type="button" class="elm-close-btn" onclick="elmClosePromo()">
      <?php esc_html_e( 'Close', 'epic-license-manager' ); ?>
    </button>
  </div>
  <script>
    function elmClosePromo() {
      if (window.AndroidBridge && typeof window.AndroidBridge.closePromo === 'function') {
        window.AndroidBridge.closePromo();
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage('elm_close_promo', '*');
      }
    }
  </script>
</body>
</html>
        <?php
        exit;
    }
}
`;
}

export function buildWooCommercePhp(): string {
  return `<?php
/**
 * WooCommerce Integration (HPOS Compatible):
 * - Leaves WooCommerce Guest Checkout & Billing Fields 100% under WooCommerce control
 * - Conditionally requires Login or Account Creation ONLY if cart contains a licensed product
 * - Maps Simple & Variable Products to App Packages (1 to 10 License Keys per variation)
 * - Issues licenses on configured Order Status transitions with Payment Method & Order Total tracking
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class ELM_WooCommerce {

    private ELM_Crypto $crypto;

    public function __construct( ELM_Crypto $crypto ) {
        $this->crypto = $crypto;

        // 1. Conditional Checkout Registration ONLY when cart has >= 1 licensed product
        add_filter( 'woocommerce_checkout_registration_required', [ $this, 'require_registration_if_licensed_in_cart' ], 20 );

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

    public function require_registration_if_licensed_in_cart( bool $required ): bool {
        $settings = get_option( 'elm_wc_settings', [] );
        if ( empty( $settings['conditional_cart_registration'] ) ) {
            return $required;
        }
        if ( ! function_exists( 'WC' ) || null === WC()->cart ) {
            return $required;
        }
        foreach ( WC()->cart->get_cart() as $cart_item ) {
            $target_id = ! empty( $cart_item['variation_id'] ) ? (int) $cart_item['variation_id'] : (int) ( $cart_item['product_id'] ?? 0 );
            if ( $target_id > 0 && (int) get_post_meta( $target_id, '_elm_app_id', true ) > 0 ) {
                return true;
            }
            $parent_id = (int) ( $cart_item['product_id'] ?? 0 );
            if ( $parent_id > 0 && (int) get_post_meta( $parent_id, '_elm_app_id', true ) > 0 ) {
                return true;
            }
        }
        return $required;
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
            'description'       => __( 'Number of separate license keys issued per variation unit.', 'epic-license-manager' ),
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
            update_post_meta( $variation_id, '_elm_license_qty', max( 1, min( 10, absint( wp_unslash( $_POST['_elm_license_qty'][ $loop ] ) ) ) ) );
        }
    }

    /** @param array<string, array<string, mixed>> $tabs */
    public function add_product_data_tab( array $tabs ): array {
        $tabs['elm_license'] = [
            'label'  => __( 'Epic License', 'epic-license-manager' ),
            'target' => 'elm_license_product_data',
            'class'  => [ 'show_if_simple' ],
        ];
        return $tabs;
    }

    public function render_product_data_panel(): void {
        global $wpdb;
        $apps = $wpdb->get_results( "SELECT id, app_name, app_slug FROM {$wpdb->prefix}elm_apps ORDER BY app_name ASC" );
        $app_options = [ '' => __( '— Not Linked —', 'epic-license-manager' ) ];
        if ( is_array( $apps ) ) {
            foreach ( $apps as $app ) {
                $app_options[ (string) $app->id ] = $app->app_name . ' (' . $app->app_slug . ')';
            }
        }

        echo '<div id="elm_license_product_data" class="panel woocommerce_options_panel">';
        woocommerce_wp_select( [ 'id' => '_elm_app_id', 'label' => __( 'Epic License App', 'epic-license-manager' ), 'options' => $app_options ] );
        woocommerce_wp_select( [
            'id' => '_elm_duration', 'label' => __( 'License Duration', 'epic-license-manager' ),
            'options' => [ '1m' => '1 Month', '3m' => '3 Months', '1y' => '1 Year', 'lifetime' => 'Lifetime' ],
        ] );
        woocommerce_wp_text_input( [
            'id' => '_elm_license_qty', 'label' => __( 'License Keys Issued (1 - 10)', 'epic-license-manager' ),
            'type' => 'number', 'custom_attributes' => [ 'min' => '1', 'max' => '10', 'step' => '1' ],
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

        if ( in_array( $new_status, [ 'refunded', 'cancelled', 'failed' ], true ) ) {
            global $wpdb;
            $wpdb->update( $wpdb->prefix . 'elm_licenses', [ 'status' => 'revoked' ], [ 'order_id' => $order_id ] );
            return;
        }

        if ( ! in_array( $new_status, $trigger_statuses, true ) ) {
            return;
        }

        if ( 'yes' === $order->get_meta( '_elm_licenses_issued', true ) ) {
            return;
        }

        global $wpdb;
        $licenses_table = $wpdb->prefix . 'elm_licenses';
        $issued_keys    = [];
        $now_mysql      = gmdate( 'Y-m-d H:i:s' );
        $user_id        = (int) $order->get_user_id();
        $cust_name      = trim( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() );
        $cust_mobile    = $order->get_billing_phone();
        $cust_email     = $order->get_billing_email();
        $payment_title  = $order->get_payment_method_title() ?: $order->get_payment_method();
        $order_total    = (float) $order->get_total();

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
                        'customer_email'  => $cust_email,
                        'customer_name'   => $cust_name,
                        'customer_mobile' => $cust_mobile,
                        'product_title'   => $item->get_name(),
                        'payment_method'  => $payment_title,
                        'order_total'     => $order_total,
                        'duration_type'   => $duration,
                        'max_activations' => 1,
                        'status'          => 'active',
                        'is_test_sandbox' => 0,
                        'issued_at'       => $now_mysql,
                    ]
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

    /** @param array<string, string> $items */
    public function add_my_account_menu_item( array $items ): array {
        $items['elm-licenses'] = __( 'My Licenses', 'epic-license-manager' );
        return $items;
    }

    public function render_my_account_licenses(): void {
        $user_id = get_current_user_id();
        if ( $user_id <= 0 ) { return; }
        global $wpdb;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT l.*, a.app_name FROM {$wpdb->prefix}elm_licenses l
                 INNER JOIN {$wpdb->prefix}elm_apps a ON a.id = l.app_id
                 WHERE l.user_id = %d AND l.is_test_sandbox = 0 ORDER BY l.id DESC",
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
            echo '<tr><td>' . esc_html( (string) $row->app_name ) . '</td><td><code>' . esc_html( (string) $row->license_key ) . '</code></td><td>' . esc_html( (string) $row->duration_type ) . '</td><td>' . esc_html( (string) $row->status ) . '</td></tr>';
        }
        echo '</tbody></table>';
    }
}
`;
}

export function buildRestApiPhp(): string {
  return `<?php
/**
 * REST API Endpoints + Core Plain Permalink & JSON Output Guard
 * Supports both /wp-json/elm/v1/* and /?rest_route=/elm/v1/* seamlessly.
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class ELM_Rest_API {

    private ELM_Crypto $crypto;

    public function __construct( ELM_Crypto $crypto ) {
        $this->crypto = $crypto;

        // Integrated Plain Permalink fallback & JSON guard inside core plugin
        add_action( 'parse_request', [ $this, 'route_plain_permalinks' ], 1 );
        add_filter( 'rest_authentication_errors', [ $this, 'allow_public_elm_routes' ], 999 );
        add_filter( 'rest_pre_serve_request', [ $this, 'guard_json_output_buffer' ], 1, 4 );

        add_action( 'rest_api_init', [ $this, 'register_routes' ] );
    }

    public function route_plain_permalinks( \\WP $wp ): void {
        if ( empty( $_SERVER['REQUEST_URI'] ) ) {
            return;
        }
        $path = parse_url( (string) wp_unslash( $_SERVER['REQUEST_URI'] ), PHP_URL_PATH );
        if ( ! is_string( $path ) ) {
            return;
        }
        $pos = strpos( $path, '/wp-json/elm/v1' );
        if ( false !== $pos ) {
            $rest_route = substr( $path, $pos + strlen( '/wp-json' ) );
            $wp->query_vars['rest_route'] = '/' . ltrim( $rest_route, '/' );
        }
    }

    public function allow_public_elm_routes( mixed $result ): mixed {
        if ( ! is_wp_error( $result ) ) {
            return $result;
        }
        $route = isset( $_GET['rest_route'] )
            ? (string) wp_unslash( $_GET['rest_route'] )
            : (string) ( $GLOBALS['wp']->query_vars['rest_route'] ?? ( $_SERVER['REQUEST_URI'] ?? '' ) );

        if ( str_contains( $route, '/elm/v1/' ) ) {
            if ( in_array( $result->get_error_code(), [ 'rest_cannot_access', 'rest_login_required', 'rest_not_logged_in' ], true ) ) {
                return null;
            }
        }
        return $result;
    }

    public function guard_json_output_buffer( mixed $served, mixed $result, \\WP_REST_Request $request, \\WP_REST_Server $server ): mixed {
        $route = $request->get_route();
        if ( str_starts_with( $route, '/elm/v1/' ) ) {
            while ( ob_get_level() > 0 ) {
                $buf = ob_get_contents();
                if ( false !== $buf && '' !== trim( $buf ) && ! str_starts_with( ltrim( $buf ), '{' ) ) {
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
    }

    public function register_routes(): void {
        $routes = [
            '/app/handshake'    => [ 'GET, POST', 'handle_handshake' ],
            '/trial/activate'   => [ 'POST', 'handle_trial_activate' ],
            '/license/activate' => [ 'POST', 'handle_license_activate' ],
            '/license/verify'   => [ 'POST', 'handle_license_verify' ],
            '/promo'            => [ 'GET',  'handle_get_promo' ],
        ];
        foreach ( $routes as $path => [ $method, $callback ] ) {
            register_rest_route( 'elm/v1', $path, [
                'methods'             => $method,
                'callback'            => [ $this, $callback ],
                'permission_callback' => '__return_true',
            ] );
        }
    }

    public function handle_handshake( \\WP_REST_Request $request ): \\WP_REST_Response {
        $slug = sanitize_key( (string) $request->get_param( 'app_slug' ) );
        global $wpdb;
        $app = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}elm_apps WHERE app_slug = %s", $slug ) );
        if ( ! $app || empty( $app->is_active ) ) {
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'app_not_found_or_disabled' ], 404 );
        }
        $pub_hex = $app->public_key_hex ?: $this->crypto->b64_to_hex( (string) $app->public_key );
        return new \\WP_REST_Response( [
            'ok'                 => true,
            'app_slug'           => $app->app_slug,
            'app_name'           => $app->app_name,
            'license_mode'       => $app->license_mode,
            'trial_days'         => (int) $app->trial_days,
            'offline_grace_days' => (int) $app->offline_grace_days,
            'public_key_b64'     => $app->public_key,
            'public_key_hex'     => $pub_hex,
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
        $is_test       = ! empty( $request->get_param( 'is_test_sandbox' ) ) ? 1 : 0;

        if ( '' === $slug || strlen( $hardware_hash ) < 16 ) {
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'invalid_hardware_fingerprint' ], 400 );
        }
        $app = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}elm_apps WHERE app_slug = %s", $slug ) );
        if ( ! $app || empty( $app->is_active ) ) {
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'app_not_found' ], 404 );
        }

        $act_table = $wpdb->prefix . 'elm_activations';
        $existing  = $wpdb->get_row(
            $wpdb->prepare( "SELECT * FROM {$act_table} WHERE app_id = %d AND hardware_hash = %s AND is_trial = 1", (int) $app->id, $hardware_hash )
        );

        $now_ts = time();
        if ( $existing ) {
            $exp_ts = strtotime( (string) $existing->trial_expires_at . ' UTC' ) ?: 0;
            if ( $exp_ts <= $now_ts ) {
                $wpdb->update(
                    $act_table,
                    [
                        'reinstall_attempts' => (int) $existing->reinstall_attempts + 1,
                        'last_error_code'    => 'trial_already_used_and_expired',
                        'last_seen_at'       => gmdate( 'Y-m-d H:i:s', $now_ts ),
                    ],
                    [ 'id' => (int) $existing->id ]
                );
                return new \\WP_REST_Response( [
                    'ok'           => false,
                    'error'        => 'trial_already_used_and_expired',
                    'message'      => __( 'Free trial already consumed on this device.', 'epic-license-manager' ),
                    'purchase_url' => $app->purchase_url,
                ], 403 );
            }
            $expires_iso = gmdate( 'c', $exp_ts );
        } else {
            $days        = max( 1, (int) $app->trial_days );
            $exp_ts      = $now_ts + ( $days * DAY_IN_SECONDS );
            $expires_iso = gmdate( 'c', $exp_ts );
            $wpdb->insert( $act_table, [
                'app_id'           => (int) $app->id,
                'hardware_hash'    => $hardware_hash,
                'device_model'     => $device_model,
                'os_version'       => $os_version,
                'is_trial'         => 1,
                'trial_started_at' => gmdate( 'Y-m-d H:i:s', $now_ts ),
                'trial_expires_at' => gmdate( 'Y-m-d H:i:s', $exp_ts ),
                'is_test_sandbox'  => $is_test,
                'last_seen_at'     => gmdate( 'Y-m-d H:i:s', $now_ts ),
                'client_last_clock'=> $now_ts,
            ] );
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
            'ok'             => true,
            'token'          => $this->crypto->sign_token( $payload, (string) $app->private_key ),
            'public_key_hex' => $app->public_key_hex ?: $this->crypto->b64_to_hex( (string) $app->public_key ),
            'payload'        => $payload,
            'purchase_url'   => $app->purchase_url,
        ], 200 );
    }

    public function handle_license_activate( \\WP_REST_Request $request ): \\WP_REST_Response {
        global $wpdb;
        $slug          = sanitize_key( (string) $request->get_param( 'app_slug' ) );
        $license_key   = strtoupper( sanitize_text_field( (string) $request->get_param( 'license_key' ) ) );
        $hardware_hash = sanitize_text_field( (string) $request->get_param( 'hardware_hash' ) );
        $device_model  = sanitize_text_field( (string) $request->get_param( 'device_model' ) );
        $os_version    = sanitize_text_field( (string) $request->get_param( 'os_version' ) );
        $is_test       = ! empty( $request->get_param( 'is_test_sandbox' ) ) ? 1 : 0;

        $app = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}elm_apps WHERE app_slug = %s", $slug ) );
        if ( ! $app || empty( $app->is_active ) ) {
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'app_not_found' ], 404 );
        }

        $lic = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}elm_licenses WHERE license_key = %s AND app_id = %d", $license_key, (int) $app->id ) );
        if ( ! $lic || 'revoked' === $lic->status ) {
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'invalid_or_revoked_license' ], 403 );
        }

        $now_ts = time();
        if ( empty( $lic->expires_at ) && 'lifetime' !== $lic->duration_type ) {
            $days = match ( $lic->duration_type ) { '1m' => 30, '3m' => 90, '1y' => 365, default => 30 };
            $exp_mysql = gmdate( 'Y-m-d H:i:s', $now_ts + ( $days * DAY_IN_SECONDS ) );
            $wpdb->update(
                $wpdb->prefix . 'elm_licenses',
                [
                    'activated_at' => gmdate( 'Y-m-d H:i:s', $now_ts ),
                    'expires_at'   => $exp_mysql,
                    'last_sync_at' => gmdate( 'Y-m-d H:i:s', $now_ts ),
                ],
                [ 'id' => (int) $lic->id ]
            );
            $expires_iso = gmdate( 'c', $now_ts + ( $days * DAY_IN_SECONDS ) );
        } else {
            $expires_iso = empty( $lic->expires_at ) ? null : gmdate( 'c', strtotime( (string) $lic->expires_at . ' UTC' ) ?: $now_ts );
        }

        // Upsert device activation telemetry
        $act_table = $wpdb->prefix . 'elm_activations';
        $wpdb->replace( $act_table, [
            'app_id'          => (int) $app->id,
            'license_id'      => (int) $lic->id,
            'hardware_hash'   => $hardware_hash,
            'device_model'    => $device_model,
            'os_version'      => $os_version,
            'is_trial'        => 0,
            'is_test_sandbox' => $is_test,
            'last_seen_at'    => gmdate( 'Y-m-d H:i:s', $now_ts ),
        ] );

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
        $wpdb->update( $wpdb->prefix . 'elm_licenses', [ 'signed_token' => $token, 'last_sync_at' => gmdate( 'Y-m-d H:i:s', $now_ts ) ], [ 'id' => (int) $lic->id ] );

        return new \\WP_REST_Response( [
            'ok'             => true,
            'token'          => $token,
            'public_key_hex' => $app->public_key_hex ?: $this->crypto->b64_to_hex( (string) $app->public_key ),
            'payload'        => $payload,
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
        $wpdb->update( $wpdb->prefix . 'elm_licenses', [ 'last_sync_at' => gmdate( 'Y-m-d H:i:s', $now_ts ), 'signed_token' => $token ], [ 'id' => (int) $lic->id ] );

        return new \\WP_REST_Response( [ 'ok' => true, 'token' => $token, 'payload' => $payload ], 200 );
    }

    public function handle_get_promo( \\WP_REST_Request $request ): \\WP_REST_Response {
        global $wpdb;
        $slug = sanitize_key( (string) $request->get_param( 'app_slug' ) );
        $app  = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}elm_apps WHERE app_slug = %s", $slug ) );
        if ( ! $app ) {
            return new \\WP_REST_Response( [ 'ok' => false, 'error' => 'app_not_found' ], 404 );
        }

        $promo_url = '';
        $html      = (string) $app->promo_html;
        if ( ! empty( $app->promo_post_id ) ) {
            $promo_post = get_post( (int) $app->promo_post_id );
            if ( $promo_post instanceof \\WP_Post && 'publish' === $promo_post->post_status ) {
                $promo_url = (string) get_permalink( $promo_post );
                if ( '' !== $promo_post->post_content ) {
                    $html = $promo_post->post_content;
                }
            }
        }

        return new \\WP_REST_Response( [
            'ok'               => true,
            'promo_enabled'    => (bool) $app->promo_enabled,
            'display_mode'     => $app->promo_display_mode,
            'interval_seconds' => (int) $app->promo_interval_sec,
            'purchase_url'     => $app->purchase_url,
            'promo_url'        => $promo_url,
            'html'             => wp_kses_post( $html ),
        ], 200 );
    }
}
`;
}
