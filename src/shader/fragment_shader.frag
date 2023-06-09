#version 300 es
precision mediump float;

#define MAX_ARRAY_SIZE 1024

uniform vec2 canvas_size;
uniform float width;
uniform float dashing;
uniform uint control_point_size;
uniform int periodic;
uniform int visible;
uniform int filled;
layout(std140) uniform spline_data {
    vec4 control_point[MAX_ARRAY_SIZE];
};

in vec3 color;
out vec4 frag_color;

// x - f(x) / f'(x) with f(x)=a*x^2, used in calculating distance from a parabola
float ns(float x, vec2 pt0, float a) {
    float a2x2 = 2. * a * a * x * x;
    return x - (pt0.x + 2. * a2x2 * x) / (1. - 2. * a * pt0.y + 3. * a2x2);
}

// Distance from a point to a parabola y = a * x ^ 2, xp is the closest point on parabola
// also referred as projection point in the following.
float dist_pt2parabola(vec2 pt, float a, out float xp) {
    float x0 = pt.y < 0. ? 0. : sqrt(pt.y / a);
    if(pt.x < 0.)
        x0 = -x0;

    // two iterates should be sufficient
    xp = x0 - ns(x0, pt, a);
    xp = xp - ns(xp, pt, a);
    return distance(pt, vec2(xp, a * xp * xp));
}

// Distance from a point to a line segment, and length from p1 to projection point is output in length
float dist_pt2line(vec2 pt, vec2 p1, vec2 p2, out float length) {
    vec2 p12 = p2 - p1;
    vec2 pp = mix(p1, p2, clamp(dot(pt - p1, p12) / dot(p12, p12), 0., 1.));
    length = distance(p1, pp);
    return distance(pt, pp);
}

// Distance from a point to a line segment
float dist_pt2line(vec2 pt, vec2 p1, vec2 p2) {
    float d;
    return dist_pt2line(pt, p1, p2, d);
}

// arc length of a parabola y = a * x ^ 2, from x1 to x2
float parabola_arc_length(float a, float x1, float x2) {
    float t1 = 2. * a * x1;
    float t2 = 2. * a * x2;
    return .5 * (x2 * sqrt(1. + t2 * t2) - x1 * sqrt(1. + t1 * t1)) + (asinh(t2) - asinh(t1)) / (4. * a);
}

// Distance from a point to a quadratic parameter curve segment, described by
// | x |              | 1   |
// |   | = coef_mat * | t   |
// | y |              | t^2 |,
// from t0 to t1. The arc length from point at t = t_arc to projection point is output in arc_len.
float dist_pt2quadratic(vec2 pt, mat3x2 coef_mat, float t0, float t1, float t_arc, out float arc_length, out float total_arc_length) {
    const float eps = .0005;
    vec2 p0 = coef_mat * vec3(1., t0, t0 * t0);
    vec2 p1 = coef_mat * vec3(1., t1, t1 * t1);
    if(abs(cross(vec3(coef_mat[1], 0.), vec3(coef_mat[2], 0.)).z) < eps) {
        // treat as straight line
        total_arc_length = distance(p0, p1);
        return dist_pt2line(pt, p0, p1, arc_length);
    }

    vec2 a = normalize(coef_mat[2]);
    mat2 rot = mat2(a.y, a.x, -a.x, a.y);
    float a_inv = inversesqrt(length(coef_mat[2]));
    vec2 bt = rot * coef_mat[1] * a_inv;
    vec2 ct = rot * coef_mat[0];
    mat3 geo_tran = mat3(rot);
    geo_tran[2] = vec3(.5 * bt.x * bt.y - ct.x, .25 * bt.y * bt.y - ct.y, 1.);
    vec3 tp = geo_tran * vec3(pt, 1.);

    float xp; // projection point
    float a_p = 1. / (bt.x * bt.x);
    float dist = dist_pt2parabola(tp.xy, a_p, xp);
    float x0_tran = (geo_tran * vec3(p0, 1.)).x;
    float x1_tran = (geo_tran * vec3(p1, 1.)).x;
    arc_length = parabola_arc_length(a_p, (geo_tran * vec3(coef_mat * vec3(1., t_arc, t_arc * t_arc), 1.)).x, xp) * sign(x1_tran - x0_tran);
    total_arc_length = parabola_arc_length(a_p, x0_tran, x1_tran) * sign(x1_tran - x0_tran);
    if((x0_tran - xp) * (x1_tran - xp) > 0.) {
        // projection point outside segment range, following distance results in a round edge
        dist = min(distance(pt, p0), distance(pt, p1));
        arc_length = total_arc_length;
    }

    return dist;
}
// TODO: Actually an accurate distance function is not necessary, it only need be accurate near the curve.
//  So solving the quadratic function directly from x0 to get curve parameter t then y should give enough
//  information for an approximate distance.

// Distance from a point to a quadratic parameter curve segment, described by
// | x |              | 1   |
// |   | = coef_mat * | t   |
// | y |              | t^2 |,
// from t0 to t1. The arc length from starting point to projection point is output in arc_len.
// If projection point is not lying on the segment, arg length will be -1.
float dist_pt2quadratic(vec2 pt, mat3x2 coef_mat, float t0, float t1, out float arc_length, out float total_arc_length) {
    return dist_pt2quadratic(pt, coef_mat, t0, t1, t0, arc_length, total_arc_length);
}

// Distance from a point to a quadratic parameter curve segment, described by
// | x |              | 1   |
// |   | = coef_mat * | t   |
// | y |              | t^2 |,
// from t0 to t1
float dist_pt2quadratic(vec2 pt, mat3x2 coef_mat, float t0, float t1) {
    float d;
    return dist_pt2quadratic(pt, coef_mat, t0, t1, d, d);
}

int horizontal_crossing_count(vec2 pt, mat3x2 coef_mat, float t0, float t1) {
    float c = coef_mat[0][1];
    float b = coef_mat[1][1];
    float a = coef_mat[2][1];

    const float eps = .0005;

    // treat as line in y direction

    if(abs(a) < eps) {
        if(abs(b) < eps) {
            return 0;
        }

        float t = (pt.y - c) / b;
        if(t < t0 || t > t1) {
            return 0;
        }

        return (coef_mat * vec3(1., t, t * t)).x < pt.x ? 1 : 0;
    }

    // general case

    float t;
    float det = b * b - 4. * a * (c - pt.y);
    if(det <= 0.) {
        return 0;
    }

    int root_num = 0;
    for(int i = 0; i < 2; ++i) {
        t = (-b + float(i * 2 - 1) * sqrt(det)) / (2. * a);
        if(t >= t0 && t <= t1 && (coef_mat * vec3(1., t, t * t)).x < pt.x) {
            ++root_num;
        }
    }
    return root_num;
}

// calculate uniform bspline value using De Boor'a algorithm, t \in [span[1],span[2]]
vec4 bspline2_val(float t, vec4 cp[3], float span[4], int der) {
    const int order = 2;
    if(der > order) {
        return vec4(0.);
    }
    for(int i = order; i > 0; --i, --der) {
        for(int k = 0; k < i; ++k) {
            float c = 1. / (span[k + order] - span[k + order - i]);
            if(der > 0) {
                cp[k] = (cp[k + 1] - cp[k]) * float(i) * c;
            } else {
                cp[k] = (cp[k] * (span[k + order] - t) + cp[k + 1] * (t - span[k + order - i])) * c;
            }
        }
    }
    return cp[0];
}

// calculate color such that a smooth transition appears when dist is slightly larger than width
void render_smooth(float dist, float elem_size, vec3 color) {
    float aa_width = float(2) / canvas_size.y;
    if(dist < elem_size + aa_width) {
        dist = smoothstep(elem_size, elem_size + aa_width, dist);
        frag_color = vec4(mix(color, frag_color.xyz, dist), 1.);
    }
}

/**
 * @brief Draw 2nd order bspline (control points given by uniform variable `spline_data`)
 *
 * @param pt current render point
 * @param line_color color of spline
 * @param size number of control points
 * @param line_width half line width
 * @param spline_periodic periodic spline or not
 * @param spline_visible a bit-mask specifying visibility of each spline
 * @param first_part control point being xy or zw component of spline_data
 * @param dashed dashing or not
 * @param filled filling interior or not
 */
void draw_bspline2(vec2 pt, vec3 line_color, uint size, float line_width, bool spline_periodic, bool spline_visible, bool first_part, bool dashed, bool filled, vec3 fill_color) {
    if(!spline_visible) {
        return;
    }

    size -= spline_periodic ? 1u : 0u;
    int seg_size = int(size) - (spline_periodic ? 0 : 2);

    float arc_length = 0.;
    if(filled) {
        int crossing_count = 0;
        vec2 p0, p1;
        for(int k = 0; k < seg_size; ++k) {
            // calculate curve parameters according to 1st spline
            float t0 = !spline_periodic && k == 0 ? 0. : float(k) + .5;
            float t1 = !spline_periodic && k == seg_size - 1 ? float(seg_size + 1) : float(k) + 1.5;
            vec4[] local_cp = vec4[3](control_point[k], control_point[(k + 1) % (int(size))], control_point[(k + 2) % (int(size))]);
            float[] local_span = float[4](spline_periodic ? t0 - 1. : k <= 1 ? 0. : t0 - 1., t0, t1, spline_periodic ? t1 + 1. : k >= seg_size - 2 ? float(seg_size + 1) : t1 + 1.);

            vec4 v_packed = bspline2_val(t0, local_cp, local_span, 0);
            vec4 d1_packed = bspline2_val(t0, local_cp, local_span, 1);
            vec4 d2_packed = bspline2_val(t0, local_cp, local_span, 2);
            mat3x2 coef_mat = first_part ? mat3x2(v_packed.xy, d1_packed.xy, .5 * d2_packed.xy) : mat3x2(v_packed.zw, d1_packed.zw, .5 * d2_packed.zw);
            crossing_count += horizontal_crossing_count(pt, coef_mat, 0., t1 - t0);

            if(k == 0) {
                p0 = coef_mat * vec3(1., 0., 0.);
            }
            if(k == seg_size - 1) {
                float dt = t1 - t0;
                p1 = coef_mat * vec3(1., dt, dt * dt);
            }
        }

        // closing spline with a line segment connecting two ends
        crossing_count += horizontal_crossing_count(pt, mat3x2(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y, 0., 0.), 0., 1.);
        if(crossing_count % 2 == 1) {
        // interior
            render_smooth(0., line_width, fill_color);
        }
    }

    for(int k = 0; k < seg_size; ++k) {
        // calculate curve parameters according to 1st spline
        float t0 = !spline_periodic && k == 0 ? 0. : float(k) + .5;
        float t1 = !spline_periodic && k == seg_size - 1 ? float(seg_size + 1) : float(k) + 1.5;
        vec4[] local_cp = vec4[3](control_point[k], control_point[(k + 1) % (int(size))], control_point[(k + 2) % (int(size))]);
        float[] local_span = float[4](spline_periodic ? t0 - 1. : k <= 1 ? 0. : t0 - 1., t0, t1, spline_periodic ? t1 + 1. : k >= seg_size - 2 ? float(seg_size + 1) : t1 + 1.);

        vec4 v_packed = bspline2_val(t0, local_cp, local_span, 0);
        vec4 d1_packed = bspline2_val(t0, local_cp, local_span, 1);
        vec4 d2_packed = bspline2_val(t0, local_cp, local_span, 2);

        float seg_arc_length;
        float current_arc_length;
        mat3x2 coef_mat = first_part ? mat3x2(v_packed.xy, d1_packed.xy, .5 * d2_packed.xy) : mat3x2(v_packed.zw, d1_packed.zw, .5 * d2_packed.zw);
        float dist = dist_pt2quadratic(pt, coef_mat, 0., t1 - t0, current_arc_length, seg_arc_length);
        if(dashed && seg_arc_length > 0. && int((arc_length + current_arc_length) / (.5 * dashing)) % 2 == 0) {
            dist = 10. * line_width; // dashing
        }
        arc_length = arc_length + seg_arc_length;
        render_smooth(dist, line_width, line_color);
    }
}

void draw_bspline2(vec2 pt, vec3 line_color, uint size, float line_width, bool spline_periodic, bool spline_visible, bool first_part, bool dashed) {
    draw_bspline2(pt, line_color, size, line_width, spline_periodic, spline_visible, first_part, dashed, false, vec3(0.));
} 

void draw_data_points(vec2 pt, vec3 color, float point_size) {
    bool p = bool(periodic & 1);
    int cp_size = int(control_point_size) - (p ? 2 : 1);
    int seg_size = int(control_point_size) - (p ? 2 : 3);
    for(int k = 0; k < seg_size; ++k) {
        float t0 = !p && k == 0 ? 0. : float(k) + .5;
        float t1 = !p && k == seg_size - 1 ? float(seg_size + 1) : float(k) + 1.5;
        vec4[] local_cp = vec4[3](control_point[k], control_point[(k + 1) % cp_size], control_point[(k + 2) % cp_size]);
        float[] local_span = float[4](p ? t0 - 1. : k <= 1 ? 0. : t0 - 1., t0, t1, p ? t1 + 1. : k >= seg_size - 2 ? float(seg_size + 1) : t1 + 1.);

        vec2 data_point;
        if(p) {
            data_point = bspline2_val(t0 + .5, local_cp, local_span, 0).xy;
        } else {
            if(k == seg_size - 1) {
                data_point = bspline2_val(t1, local_cp, local_span, 0).xy;
                render_smooth(distance(pt, data_point), point_size, color);
            }
            if(k == 0) {
                data_point = bspline2_val(t0, local_cp, local_span, 0).xy;
                render_smooth(distance(pt, data_point), point_size, color);
                data_point = bspline2_val(t0 + 1., local_cp, local_span, 0).xy;
            } else {
                data_point = bspline2_val(t0 + .5, local_cp, local_span, 0).xy;
            }
        }
        render_smooth(distance(pt, data_point), point_size, color);
    }
}
void draw_knot_points() {
}

void main() {
    float aspect_ratio = canvas_size.x / canvas_size.y;
    vec2 uv = (gl_FragCoord.xy / canvas_size) - vec2(.5, .5);
    uv.x *= aspect_ratio;
    // uv is normalized coordinate with y from 0 to 1 and x from -a/2 to a/2, 
    // starting from lower-left corner, where a is aspect ratio.
    // (Note: it depends on the qualifier `origin_upper_left` and `pixel_center_integer` of gl_FragCoord)

    vec3 background_color = color;
    // foreground being light blue (default color of mma's plot)
    // TODO: color should be a uniform
    vec3 foreground_color = vec3(0.368417, 0.506779, 0.709798);
    vec3 foreground_color2 = vec3(0.880722, 0.611041, 0.142051);
    vec3 foreground_color3 = vec3(0.560181, 0.691569, 0.194885);
    vec3 foreground_color4 = vec3(0.922526, 0.385626, 0.209179);
    frag_color = vec4(background_color, 1.0);

    float fixed_line_width = .6 * width;
    float pending_line_width = .3 * width;
    vec3 fixed_line_color = .5 * foreground_color;
    vec3 pending_line_color = foreground_color;

    float data_point_size = 2. * width;

    if(control_point_size == 1u) {
        // draw a point
        render_smooth(distance(uv, control_point[0].xy), .5 * width, foreground_color);
    } else if(control_point_size == 2u) {
        // draw a line segment
        float len;
        float dist = dist_pt2line(uv, control_point[0].xy, control_point[1].xy, len);
        if(int(len / (.5 * dashing)) % 2 == 0) {
            dist = 10. * width;
        }
        render_smooth(dist, pending_line_width, pending_line_color);
        render_smooth(distance(uv, control_point[0].xy), data_point_size, foreground_color3);
    } else {
        if(control_point_size == 3u) {
            render_smooth(dist_pt2line(uv, control_point[0].xy, control_point[1].xy), fixed_line_width, fixed_line_color);
        }
        // draw bspline curve
        draw_bspline2(uv, fixed_line_color, control_point_size - 1u, fixed_line_width, bool(periodic & 1), bool(visible & 1), true, false, bool(filled & 1), foreground_color4);
        draw_bspline2(uv, pending_line_color, control_point_size, pending_line_width, bool(periodic & 2), bool(visible & 2), false, true);

        if(control_point_size == 3u) {
            render_smooth(distance(uv, control_point[0].xy), data_point_size, foreground_color3);
            render_smooth(distance(uv, control_point[1].xy), data_point_size, foreground_color3);
        }
        draw_data_points(uv, foreground_color3, data_point_size);
    }
}
