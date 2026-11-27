export function buildCustomFieldsPhp(): string {
  return `<?php
/**
 * Native ACF-Style Custom Fields & Conditional Logic Engine
 * - Stores data in standard WordPress meta (wp_postmeta, wp_usermeta, HPOS WC_Order meta)
 * - Exposes developer template tags: elm_get_field(), elm_the_field() alongside get_post_meta() / get_post_custom()
 * - Supports Shortcode [elm_field], Gutenberg Block, and Conditional Auto-Injection into themes/WooCommerce
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class ELM_Custom_Fields {

    private ELM_Calendar $calendar;

    public function __construct( ELM_Calendar $calendar ) {
        $this->calendar = $calendar;

        add_action( 'init', [ $this, 'register_all_meta_and_block' ] );

        // Backend meta boxes & saves (Posts, Pages, CPTs, Products, HPOS Orders)
        add_action( 'add_meta_boxes', [ $this, 'register_meta_boxes' ], 10, 2 );
        add_action( 'save_post', [ $this, 'save_post_meta_fields' ], 10, 2 );
        add_action( 'woocommerce_process_shop_order_meta', [ $this, 'save_order_meta_fields' ], 10, 2 );

        // WooCommerce Product Variations
        add_action( 'woocommerce_product_after_variable_attributes', [ $this, 'render_variation_custom_fields' ], 20, 3 );
        add_action( 'woocommerce_save_product_variation', [ $this, 'save_variation_custom_fields' ], 20, 2 );

        // WordPress User Profile
        add_action( 'show_user_profile', [ $this, 'render_user_custom_fields' ] );
        add_action( 'edit_user_profile', [ $this, 'render_user_custom_fields' ] );
        add_action( 'personal_options_update', [ $this, 'save_user_custom_fields' ] );
        add_action( 'edit_user_profile_update', [ $this, 'save_user_custom_fields' ] );

        // Backend media uploader helper
        add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_cf_media_assets' ] );

        // Frontend Shortcode & Conditional Auto-Injection (Zero theme editing)
        add_shortcode( 'elm_field', [ $this, 'render_shortcode' ] );
        add_filter( 'the_content', [ $this, 'auto_inject_the_content' ], 25 );
        add_action( 'woocommerce_single_product_summary', [ $this, 'auto_inject_wc_summary' ], 35 );
        add_action( 'woocommerce_before_add_to_cart_button', [ $this, 'auto_inject_wc_before_cart' ], 15 );
        add_action( 'woocommerce_account_dashboard', [ $this, 'auto_inject_wc_account' ], 15 );
    }

    public function enqueue_cf_media_assets( string $hook ): void {
        if ( ! in_array( $hook, [ 'post.php', 'post-new.php', 'profile.php', 'user-edit.php', 'woocommerce_page_wc-orders' ], true ) ) {
            return;
        }
        if ( function_exists( 'wp_enqueue_media' ) ) {
            wp_enqueue_media();
        }
        $js = "document.addEventListener('click',function(e){var btn=e.target.closest('.elm-cf-media-btn');if(!btn||typeof wp==='undefined'||!wp.media)return;e.preventDefault();var target=document.getElementById(btn.getAttribute('data-target'));var frame=wp.media({title:'Select Media',multiple:false});frame.on('select',function(){var att=frame.state().get('selection').first().toJSON();if(target)target.value=att.url||'';});frame.open();});";
        wp_register_script( 'elm-cf-inline', '', [], ELM_VERSION, true );
        wp_enqueue_script( 'elm-cf-inline' );
        wp_add_inline_script( 'elm-cf-inline', $js );
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function get_groups(): array {
        $saved = get_option( 'elm_custom_field_groups', [] );
        return is_array( $saved ) ? $saved : [];
    }

    /**
     * @param array<int, array<string, mixed>> $groups
     */
    public function save_groups( array $groups ): void {
        update_option( 'elm_custom_field_groups', array_values( $groups ) );
    }

    public function register_all_meta_and_block(): void {
        foreach ( $this->get_groups() as $group ) {
            if ( empty( $group['active'] ) || empty( $group['fields'] ) || ! is_array( $group['fields'] ) ) {
                continue;
            }
            $targets = is_array( $group['targets'] ?? null ) ? $group['targets'] : [];
            foreach ( $group['fields'] as $field ) {
                $name = sanitize_key( (string) ( $field['name'] ?? '' ) );
                if ( '' === $name ) {
                    continue;
                }
                $meta_type = ( 'number' === ( $field['type'] ?? '' ) ) ? 'number' : 'string';
                if ( in_array( 'wp_post', $targets, true ) || in_array( 'wp_page', $targets, true ) || in_array( 'wc_product', $targets, true ) ) {
                    register_meta( 'post', $name, [
                        'type'              => $meta_type,
                        'single'            => true,
                        'show_in_rest'      => true,
                        'sanitize_callback' => 'sanitize_text_field',
                    ] );
                }
                if ( in_array( 'wp_user', $targets, true ) ) {
                    register_meta( 'user', $name, [
                        'type'              => $meta_type,
                        'single'            => true,
                        'show_in_rest'      => true,
                        'sanitize_callback' => 'sanitize_text_field',
                    ] );
                }
            }
        }

        if ( function_exists( 'register_block_type' ) ) {
            register_block_type( 'elm/custom-field', [
                'attributes'      => [
                    'name'     => [ 'type' => 'string', 'default' => '' ],
                    'objectId' => [ 'type' => 'number', 'default' => 0 ],
                ],
                'render_callback' => function ( array $attrs ): string {
                    return $this->render_shortcode( [
                        'name' => (string) ( $attrs['name'] ?? '' ),
                        'id'   => (string) ( $attrs['objectId'] ?? '' ),
                    ] );
                },
            ] );
        }
    }

    /**
     * Evaluates backend or frontend display conditions for a field group.
     *
     * @param array<string, mixed> $group
     */
    public function evaluate_conditions( array $group, int $object_id = 0, string $context = 'frontend' ): bool {
        if ( empty( $group['active'] ) ) {
            return false;
        }
        $rules = is_array( $group['conditions'] ?? null ) ? $group['conditions'] : [];
        if ( empty( $rules ) ) {
            return true;
        }

        foreach ( $rules as $rule ) {
            $param    = (string) ( $rule['param'] ?? '' );
            $operator = (string) ( $rule['operator'] ?? 'equals' );
            $expected = (string) ( $rule['value'] ?? '' );
            $actual   = '';

            if ( 'user_logged_in' === $param ) {
                $actual = is_user_logged_in() ? 'yes' : 'no';
            } elseif ( 'user_role' === $param ) {
                $user   = wp_get_current_user();
                $actual = implode( ',', $user->roles );
            } elseif ( 'page_id' === $param ) {
                $actual = (string) ( $object_id ?: get_the_ID() );
            } elseif ( 'url_pattern' === $param ) {
                $actual = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
            } elseif ( 'wc_product_type' === $param && function_exists( 'wc_get_product' ) && $object_id > 0 ) {
                $prod   = wc_get_product( $object_id );
                $actual = $prod ? $prod->get_type() : '';
            } elseif ( 'wc_variation_id' === $param ) {
                $actual = (string) $object_id;
            } elseif ( 'has_active_license' === $param ) {
                $uid    = get_current_user_id();
                $actual = $this->user_has_active_license( $uid ) ? 'yes' : 'no';
            } elseif ( 'field_equals' === $param && str_contains( $expected, ':' ) ) {
                [ $other_name, $other_val ] = explode( ':', $expected, 2 );
                $actual   = (string) $this->get_field_value( trim( $other_name ), $object_id );
                $expected = trim( $other_val );
            }

            $matched = match ( $operator ) {
                'not_equals' => $actual !== $expected,
                'contains'   => '' !== $expected && str_contains( $actual, $expected ),
                default      => 'user_role' === $param ? in_array( $expected, explode( ',', $actual ), true ) : ( $actual === $expected ),
            };

            if ( ! $matched ) {
                return false;
            }
        }
        return true;
    }

    private function user_has_active_license( int $user_id ): bool {
        if ( $user_id <= 0 ) {
            return false;
        }
        global $wpdb;
        $cnt = (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COUNT(*) FROM {$wpdb->prefix}elm_licenses WHERE user_id = %d AND status = 'active' AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())",
                $user_id
            )
        );
        return $cnt > 0;
    }

    public function register_meta_boxes( string $post_type, mixed $post_or_order ): void {
        $groups = $this->get_groups();
        $obj_id = $post_or_order instanceof \\WP_Post ? $post_or_order->ID : ( $post_or_order instanceof \\WC_Order ? $post_or_order->get_id() : 0 );

        foreach ( $groups as $group ) {
            $targets = is_array( $group['targets'] ?? null ) ? $group['targets'] : [];
            $screens = [];
            if ( in_array( 'wp_post', $targets, true ) ) { $screens[] = 'post'; }
            if ( in_array( 'wp_page', $targets, true ) ) { $screens[] = 'page'; }
            if ( in_array( 'wc_product', $targets, true ) ) { $screens[] = 'product'; }
            if ( in_array( 'wc_order', $targets, true ) ) {
                $screens[] = 'shop_order';
                if ( function_exists( 'wc_get_page_screen_id' ) ) {
                    $screens[] = wc_get_page_screen_id( 'shop-order' );
                }
            }

            if ( in_array( $post_type, $screens, true ) && $this->evaluate_conditions( $group, $obj_id, 'backend' ) ) {
                add_meta_box(
                    'elm_cf_' . sanitize_key( (string) $group['id'] ),
                    (string) ( $group['title'] ?? 'Epic Custom Fields' ),
                    function ( mixed $obj ) use ( $group ): void {
                        $this->render_group_inputs( $group, $obj );
                    },
                    $post_type,
                    'normal',
                    'default'
                );
            }
        }
    }

    private function render_group_inputs( array $group, mixed $obj ): void {
        wp_nonce_field( 'elm_cf_save_nonce', 'elm_cf_nonce' );
        $is_order = $obj instanceof \\WC_Order;
        $is_user  = $obj instanceof \\WP_User;
        $obj_id   = $is_order ? $obj->get_id() : ( $is_user ? $obj->ID : ( $obj instanceof \\WP_Post ? $obj->ID : 0 ) );

        echo '<table class="form-table elm-cf-table"><tbody>';
        foreach ( (array) ( $group['fields'] ?? [] ) as $field ) {
            $name  = sanitize_key( (string) ( $field['name'] ?? '' ) );
            $label = (string) ( $field['label'] ?? $name );
            $type  = (string) ( $field['type'] ?? 'text' );
            if ( '' === $name ) { continue; }

            $val = $is_order
                ? $obj->get_meta( $name, true )
                : ( $is_user ? get_user_meta( $obj_id, $name, true ) : get_post_meta( $obj_id, $name, true ) );
            if ( '' === $val && ! empty( $field['defaultValue'] ) ) {
                $val = $field['defaultValue'];
            }

            echo '<tr><th><label for="elm_cf_' . esc_attr( $name ) . '">' . esc_html( $label ) . '</label></th><td>';
            $this->render_single_input( 'elm_cf[' . $name . ']', 'elm_cf_' . $name, $type, $val, $field );
            echo '</td></tr>';
        }
        echo '</tbody></table>';
    }

    private function render_single_input( string $input_name, string $id, string $type, mixed $val, array $field ): void {
        $str_val = is_scalar( $val ) ? (string) $val : '';
        $choices = is_array( $field['choices'] ?? null ) ? $field['choices'] : [];

        if ( 'textarea' === $type ) {
            echo '<textarea id="' . esc_attr( $id ) . '" name="' . esc_attr( $input_name ) . '" rows="3" class="large-text">' . esc_textarea( $str_val ) . '</textarea>';
        } elseif ( 'select' === $type ) {
            echo '<select id="' . esc_attr( $id ) . '" name="' . esc_attr( $input_name ) . '">';
            foreach ( $choices as $c ) {
                echo '<option value="' . esc_attr( (string) $c ) . '"' . selected( $str_val, (string) $c, false ) . '>' . esc_html( (string) $c ) . '</option>';
            }
            echo '</select>';
        } elseif ( 'radio' === $type ) {
            foreach ( $choices as $c ) {
                echo '<label style="margin-inline-end:12px;"><input type="radio" name="' . esc_attr( $input_name ) . '" value="' . esc_attr( (string) $c ) . '"' . checked( $str_val, (string) $c, false ) . ' /> ' . esc_html( (string) $c ) . '</label>';
            }
        } elseif ( 'checkbox' === $type ) {
            $arr = is_array( $val ) ? $val : ( '' !== $str_val ? explode( ',', $str_val ) : [] );
            foreach ( $choices as $c ) {
                echo '<label style="margin-inline-end:12px;"><input type="checkbox" name="' . esc_attr( $input_name ) . '[]" value="' . esc_attr( (string) $c ) . '"' . checked( in_array( (string) $c, $arr, true ), true, false ) . ' /> ' . esc_html( (string) $c ) . '</label>';
            }
        } elseif ( 'true_false' === $type ) {
            echo '<label><input type="checkbox" id="' . esc_attr( $id ) . '" name="' . esc_attr( $input_name ) . '" value="1"' . checked( $str_val, '1', false ) . ' /> ' . esc_html__( 'Yes / Active', 'epic-license-manager' ) . '</label>';
        } elseif ( 'repeater' === $type ) {
            $json = is_array( $val ) ? wp_json_encode( $val, JSON_UNESCAPED_UNICODE ) : $str_val;
            echo '<textarea id="' . esc_attr( $id ) . '" name="' . esc_attr( $input_name ) . '" rows="3" class="large-text code" placeholder="' . esc_attr( '[{"item":"value"}]' ) . '">' . esc_textarea( (string) $json ) . '</textarea>';
            echo '<p class="description">' . esc_html__( 'JSON array rows for Repeater items (parsed automatically by elm_get_field()).', 'epic-license-manager' ) . '</p>';
        } elseif ( 'media' === $type ) {
            echo '<div style="display:flex;gap:8px;align-items:center;"><input type="url" id="' . esc_attr( $id ) . '" name="' . esc_attr( $input_name ) . '" value="' . esc_attr( $str_val ) . '" placeholder="https://.../wp-content/uploads/..." class="regular-text" />';
            echo '<button type="button" class="button elm-cf-media-btn" data-target="' . esc_attr( $id ) . '">' . esc_html__( 'Select Media', 'epic-license-manager' ) . '</button></div>';
        } elseif ( 'date_triple' === $type ) {
            echo '<input type="date" id="' . esc_attr( $id ) . '" name="' . esc_attr( $input_name ) . '" value="' . esc_attr( $str_val ) . '" class="regular-text" />';
            if ( '' !== $str_val ) {
                echo '<p class="description">' . esc_html( $this->calendar->format_mysql_datetime( $str_val . ' 00:00:00', 'plugin', false ) ) . '</p>';
            }
        } else {
            $html_type = in_array( $type, [ 'number', 'email', 'url' ], true ) ? $type : 'text';
            echo '<input type="' . esc_attr( $html_type ) . '" id="' . esc_attr( $id ) . '" name="' . esc_attr( $input_name ) . '" value="' . esc_attr( $str_val ) . '" class="regular-text" />';
        }
    }

    public function save_post_meta_fields( int $post_id, \\WP_Post $post ): void {
        if ( ! isset( $_POST['elm_cf_nonce'] ) || ! wp_verify_nonce( (string) wp_unslash( $_POST['elm_cf_nonce'] ), 'elm_cf_save_nonce' ) ) {
            return;
        }
        if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) { return; }
        if ( ! current_user_can( 'edit_post', $post_id ) ) { return; }
        if ( empty( $_POST['elm_cf'] ) || ! is_array( $_POST['elm_cf'] ) ) { return; }

        foreach ( wp_unslash( $_POST['elm_cf'] ) as $key => $raw ) {
            $clean_key = sanitize_key( (string) $key );
            $clean_val = is_array( $raw ) ? array_map( 'sanitize_text_field', $raw ) : sanitize_textarea_field( (string) $raw );
            update_post_meta( $post_id, $clean_key, $clean_val );
        }
    }

    public function save_order_meta_fields( int $order_id, mixed $post_or_order ): void {
        if ( ! isset( $_POST['elm_cf_nonce'] ) || ! wp_verify_nonce( (string) wp_unslash( $_POST['elm_cf_nonce'] ), 'elm_cf_save_nonce' ) ) {
            return;
        }
        $order = wc_get_order( $order_id );
        if ( ! $order instanceof \\WC_Order || empty( $_POST['elm_cf'] ) || ! is_array( $_POST['elm_cf'] ) ) {
            return;
        }
        foreach ( wp_unslash( $_POST['elm_cf'] ) as $key => $raw ) {
            $clean_key = sanitize_key( (string) $key );
            $clean_val = is_array( $raw ) ? array_map( 'sanitize_text_field', $raw ) : sanitize_textarea_field( (string) $raw );
            $order->update_meta_data( $clean_key, $clean_val );
        }
        $order->save();
    }

    public function render_variation_custom_fields( int $loop, array $variation_data, \\WP_Post $variation ): void {
        foreach ( $this->get_groups() as $group ) {
            $targets = is_array( $group['targets'] ?? null ) ? $group['targets'] : [];
            if ( ! in_array( 'wc_variation', $targets, true ) || ! $this->evaluate_conditions( $group, $variation->ID, 'backend' ) ) {
                continue;
            }
            echo '<div class="elm-variation-box options_group"><p><strong>' . esc_html( (string) $group['title'] ) . '</strong></p>';
            foreach ( (array) ( $group['fields'] ?? [] ) as $field ) {
                $name = sanitize_key( (string) ( $field['name'] ?? '' ) );
                if ( '' === $name ) { continue; }
                woocommerce_wp_text_input( [
                    'id'    => "elm_cf_var[{$loop}][{$name}]",
                    'label' => (string) ( $field['label'] ?? $name ),
                    'value' => (string) get_post_meta( $variation->ID, $name, true ),
                ] );
            }
            echo '</div>';
        }
    }

    public function save_variation_custom_fields( int $variation_id, int $loop ): void {
        if ( empty( $_POST['elm_cf_var'][ $loop ] ) || ! is_array( $_POST['elm_cf_var'][ $loop ] ) ) {
            return;
        }
        foreach ( wp_unslash( $_POST['elm_cf_var'][ $loop ] ) as $key => $val ) {
            update_post_meta( $variation_id, sanitize_key( (string) $key ), sanitize_text_field( (string) $val ) );
        }
    }

    public function render_user_custom_fields( \\WP_User $user ): void {
        foreach ( $this->get_groups() as $group ) {
            $targets = is_array( $group['targets'] ?? null ) ? $group['targets'] : [];
            if ( ! in_array( 'wp_user', $targets, true ) || ! $this->evaluate_conditions( $group, $user->ID, 'backend' ) ) {
                continue;
            }
            echo '<h3>' . esc_html( (string) $group['title'] ) . '</h3>';
            $this->render_group_inputs( $group, $user );
        }
    }

    public function save_user_custom_fields( int $user_id ): void {
        if ( ! isset( $_POST['elm_cf_nonce'] ) || ! wp_verify_nonce( (string) wp_unslash( $_POST['elm_cf_nonce'] ), 'elm_cf_save_nonce' ) ) {
            return;
        }
        if ( ! current_user_can( 'edit_user', $user_id ) || empty( $_POST['elm_cf'] ) || ! is_array( $_POST['elm_cf'] ) ) {
            return;
        }
        foreach ( wp_unslash( $_POST['elm_cf'] ) as $key => $raw ) {
            $clean_key = sanitize_key( (string) $key );
            $clean_val = is_array( $raw ) ? array_map( 'sanitize_text_field', $raw ) : sanitize_textarea_field( (string) $raw );
            update_user_meta( $user_id, $clean_key, $clean_val );
        }
    }

    public function get_field_value( string $field_name, int $object_id = 0, string $target = 'auto' ): mixed {
        $key = sanitize_key( $field_name );
        if ( 'user' === $target ) {
            $uid = $object_id ?: get_current_user_id();
            return $uid > 0 ? get_user_meta( $uid, $key, true ) : '';
        }
        $pid = $object_id ?: (int) get_the_ID();
        if ( $pid > 0 ) {
            $val = get_post_meta( $pid, $key, true );
            if ( '' !== $val && [] !== $val ) {
                return $val;
            }
        }
        $uid = get_current_user_id();
        return $uid > 0 ? get_user_meta( $uid, $key, true ) : '';
    }

    /** @param array<string, string> $atts */
    public function render_shortcode( array $atts ): string {
        $atts = shortcode_atts( [ 'name' => '', 'id' => '0', 'target' => 'auto' ], $atts );
        $name = sanitize_key( $atts['name'] );
        if ( '' === $name ) { return ''; }
        $val = $this->get_field_value( $name, absint( $atts['id'] ), $atts['target'] );
        if ( is_array( $val ) ) {
            return '<span class="elm-custom-field">' . esc_html( implode( '، ', array_map( 'strval', $val ) ) ) . '</span>';
        }
        return '' !== (string) $val ? '<span class="elm-custom-field">' . esc_html( (string) $val ) . '</span>' : '';
    }

    private function render_injected_groups( string $hook_name, int $object_id ): string {
        $out = '';
        foreach ( $this->get_groups() as $group ) {
            if ( empty( $group['autoInjectFrontend'] ) || ( $group['injectHook'] ?? '' ) !== $hook_name ) {
                continue;
            }
            if ( ! $this->evaluate_conditions( $group, $object_id, 'frontend' ) ) {
                continue;
            }
            $rows = '';
            foreach ( (array) ( $group['fields'] ?? [] ) as $field ) {
                $name  = sanitize_key( (string) ( $field['name'] ?? '' ) );
                $label = (string) ( $field['label'] ?? $name );
                $val   = $this->get_field_value( $name, $object_id );
                if ( empty( $val ) ) { continue; }
                $display = is_array( $val ) ? implode( '، ', array_map( 'strval', $val ) ) : (string) $val;
                $rows .= '<div class="elm-cf-row"><strong>' . esc_html( $label ) . ':</strong> <span>' . esc_html( $display ) . '</span></div>';
            }
            if ( '' !== $rows ) {
                $out .= '<div class="elm-cf-frontend-box" style="margin:14px 0;padding:12px 16px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">' . $rows . '</div>';
            }
        }
        return $out;
    }

    public function auto_inject_the_content( string $content ): string {
        if ( ! is_singular() || ! in_the_loop() || ! is_main_query() ) {
            return $content;
        }
        return $content . $this->render_injected_groups( 'the_content_after', (int) get_the_ID() );
    }

    public function auto_inject_wc_summary(): void {
        echo $this->render_injected_groups( 'wc_single_product_summary', (int) get_the_ID() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
    }

    public function auto_inject_wc_before_cart(): void {
        echo $this->render_injected_groups( 'wc_before_add_to_cart', (int) get_the_ID() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
    }

    public function auto_inject_wc_account(): void {
        echo $this->render_injected_groups( 'wc_account_dashboard', get_current_user_id() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
    }
}

if ( ! function_exists( 'elm_get_field' ) ) {
    function elm_get_field( string $field_name, int $object_id = 0, string $target = 'auto' ): mixed {
        return Epic_License_Manager::instance()->custom_fields->get_field_value( $field_name, $object_id, $target );
    }
}

if ( ! function_exists( 'elm_the_field' ) ) {
    function elm_the_field( string $field_name, int $object_id = 0, string $target = 'auto' ): void {
        $val = elm_get_field( $field_name, $object_id, $target );
        if ( is_array( $val ) ) {
            echo esc_html( implode( '، ', array_map( 'strval', $val ) ) );
        } else {
            echo esc_html( (string) $val );
        }
    }
}
`;
}
