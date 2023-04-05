#version 300 es
precision mediump float;

#define MAX_ARRAY_SIZE 1024

uniform vec2 canvas_size;
uniform float width;
uniform float dashing;
uniform uint control_point_size;
uniform bool periodic;
layout(std140) uniform spline_data {
    vec4 control_point[MAX_ARRAY_SIZE];
};

in vec3 color;
out vec4 frag_color;

// x - f(x) / f'(x), used in calculating distance from a parabola
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

// Distance from a point to a line segment
float dist_pt2line(vec2 pt, vec2 p1, vec2 p2) {
    vec2 p1t = pt - p1;
    vec2 p2t = pt - p2;
    vec2 p12 = p2 - p1;

    vec2 pp = p1 + dot(p1t, p12) / dot(p12, p12) * p12;
    if(dot(pp - p1, pp - p2) < 0.) {
        return distance(pt, pp);
    } else {
        return min(length(p1t), length(p2t));
    }
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
float dist_pt2quadratic(vec2 pt, mat3x2 coef_mat, float t0, float t1, float t_arc, out float arc_length) {
    const float eps = .00001;
    vec2 p0 = coef_mat * vec3(1., t0, t0 * t0);
    vec2 p1 = coef_mat * vec3(1., t1, t1 * t1);
    if(abs(cross(vec3(coef_mat[1], 0.), vec3(coef_mat[2], 0.)).z) < eps) {
        // treat as straight line
        return dist_pt2line(pt, p0, p1);
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
    if((x0_tran - xp) * (x1_tran - xp) > 0.) {
        // projection point outside segment range
        dist = min(distance(pt, p0), distance(pt, p1));
    }
    arc_length = parabola_arc_length(a_p, (geo_tran * vec3(coef_mat * vec3(1., t_arc, t_arc * t_arc), 1.)).x, xp) * sign(x1_tran - x0_tran);

    return dist;
}

// Distance from a point to a quadratic parameter curve segment, described by
// | x |              | 1   |
// |   | = coef_mat * | t   |
// | y |              | t^2 |,
// from t0 to t1. The arc length from starting point to projection point is output in arc_len.
// If projection point is not lying on the segment, arg length will be -1.
float dist_pt2quadratic(vec2 pt, mat3x2 coef_mat, float t0, float t1, out float arc_length) {
    return dist_pt2quadratic(pt, coef_mat, t0, t1, t0, arc_length);
}

// Distance from a point to a quadratic parameter curve segment, described by
// | x |              | 1   |
// |   | = coef_mat * | t   |
// | y |              | t^2 |,
// from t0 to t1
float dist_pt2quadratic(vec2 pt, mat3x2 coef_mat, float t0, float t1) {
    float d;
    return dist_pt2quadratic(pt, coef_mat, t0, t1, d);
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
void render_smooth(float dist, float width, vec3 color) {
    if(dist < width * 1.5) {
        dist = smoothstep(width, width * 1.5, dist);
        frag_color = vec4(mix(color, frag_color.xyz, dist), 1.);
    }
}

/**
 * @brief Draw two 2nd order bspline (control points given by uniform variable `spline_data`)
 *
 * @param pt current render point
 * @param color color of spline
 * @param size number of control points
 * @param periodic periodic spline or not
 * @param visible a bit-mask specifying visibility of each spline
 */
void draw_bspline2(vec2 pt, vec3[2] line_color, uint[2] size, float[2] line_width, bool[2] periodic, int visible) {
    int seg_size1 = int(size[0]) - (periodic[0] ? 1 : 2);
    int seg_size2 = int(size[1]) - (periodic[1] ? 1 : 2);

    // size[1] always larger than size[0], and the loop is done for the larger count
    for(int k = 0; k < seg_size2; ++k) {
        // calculate curve parameters according to 1st spline
        float t0 = periodic[0] ? float(k) + .5 : k == 0 ? 0. : float(k) + .5;
        float t1 = periodic[0] ? float((k + 1) % seg_size1) + .5 : k == seg_size1 - 1 ? float(seg_size1 + 1) : float(k) + 1.5;
        vec4[] local_cp = vec4[3](control_point[k], control_point[k + 1], control_point[(k + 2) % (int(size[0]))]);
        float[] local_span = float[4](periodic[0] ? t0 - 1. : k <= 1 ? 0. : t0 - 1., t0, t1, periodic[0] ? t1 + 1. : k >= seg_size1 - 2 ? float(seg_size1 + 1) : t1 + 1.);

        vec4 v_packed = bspline2_val(t0, local_cp, local_span, 0);
        vec4 d1_packed = bspline2_val(t0, local_cp, local_span, 1);
        vec4 d2_packed = bspline2_val(t0, local_cp, local_span, 2);

        // 1st spline
        if(k < seg_size1 && bool(visible & 1)) {
            float dist = dist_pt2quadratic(pt, mat3x2(v_packed.xy, d1_packed.xy, .5 * d2_packed.xy), 0., t1 - t0);
            render_smooth(dist, line_width[0], line_color[0]);
        }

        // 2nd spline
        if(bool(visible & 2)) {
            float s2_t0 = periodic[1] ? float(k) + .5 : k == 0 ? 0. : float(k) + .5;
            float s2_t1 = periodic[1] ? float((k + 1) % seg_size2) + .5 : k == seg_size2 - 1 ? float(seg_size2 + 1) : float(k) + 1.5;
            mat3x2 coef;
            if(k < seg_size1 - 2) {
                coef = mat3x2(v_packed.zw, d1_packed.zw, .5 * d2_packed.zw);
            } else {
                vec4[] s2_cp = vec4[3](control_point[k], control_point[k + 1], control_point[(k + 2) % (int(size[1]))]);
                float[] s2_span = float[4](periodic[1] ? s2_t0 - 1. : k <= 1 ? 0. : s2_t0 - 1., s2_t0, s2_t1, periodic[1] ? s2_t1 + 1. : k >= seg_size2 - 2 ? float(seg_size2 + 1) : s2_t1 + 1.);

                vec2 s2_v = bspline2_val(s2_t0, s2_cp, s2_span, 0).zw;
                vec2 s2_d1 = bspline2_val(s2_t0, s2_cp, s2_span, 1).zw;
                vec2 s2_d2 = bspline2_val(s2_t0, s2_cp, s2_span, 2).zw;
                coef = mat3x2(s2_v, s2_d1, .5 * s2_d2);
            }

            float dist;
            if(k == seg_size2 - 1) {
                float arc_length;
                dist = dist_pt2quadratic(pt, coef, 0., s2_t1 - s2_t0, k == 0 ? 1. : .5, arc_length);
                if(arc_length > 0. && int(arc_length / (.5 * dashing)) % 2 == 0) {
                    dist = 10. * width; // dashing
                }
            } else {
                dist = dist_pt2quadratic(pt, coef, 0., s2_t1 - s2_t0);
            }

            render_smooth(dist, line_width[1], line_color[1]);
        }
    }
}

void main() {
    float aspect_ratio = canvas_size.x / canvas_size.y;
    vec2 uv = (gl_FragCoord.xy / canvas_size) - vec2(.5, 0.);
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
    float[] line_width = float[2](fixed_line_width, pending_line_width);
    vec3 fixed_line_color = .5 * foreground_color;
    vec3 pending_line_color = foreground_color;
    vec3[] line_colors = vec3[2](.5 * foreground_color, foreground_color);

    if(control_point_size == 1u) {
        // draw a point
        render_smooth(distance(uv, control_point[0].xy), .5 * width, foreground_color);
    } else if(control_point_size == 2u) {
        // draw a line segment
        render_smooth(dist_pt2line(uv, control_point[0].xy, control_point[1].xy), pending_line_width, pending_line_color);
    } else {
        if(control_point_size == 3u) {
            render_smooth(dist_pt2line(uv, control_point[0].xy, control_point[1].xy), fixed_line_width, fixed_line_color);
        }
        // draw bspline curve
        draw_bspline2(uv, line_colors, uint[2](control_point_size - 1u, control_point_size), line_width, bool[2](periodic, false), periodic ? 1 : 3);

        // and data points and knot points
        int seg_size = int(control_point_size) - 2;
        for(int k = 0; k < seg_size; ++k) {
            float t0 = k == 0 ? 0. : float(k) + .5;
            float s1_t1 = k == seg_size - 2 ? float(seg_size) : float(k) + 1.5;
            float s2_t1 = k == seg_size - 1 ? float(seg_size + 1) : float(k) + 1.5;
            vec4[] local_cp = vec4[3](control_point[k], control_point[k + 1], control_point[k + 2]);
            float[] s1_local_span = float[4](k <= 1 ? 0. : t0 - 1., t0, s1_t1, k >= seg_size - 3 ? float(seg_size) : s1_t1 + 1.);
            float[] s2_local_span = float[4](k <= 1 ? 0. : t0 - 1., t0, s2_t1, k >= seg_size - 2 ? float(seg_size + 1) : s2_t1 + 1.);

            vec2 knot_point = bspline2_val(t0, local_cp, s1_local_span, 0).xy;
            vec2 data_point;

            if(k < seg_size - 1) {
                render_smooth(distance(uv, knot_point), 1.5 * width, foreground_color2);
            }
            if(k == seg_size - 1) {
                data_point = bspline2_val(s2_t1, local_cp, s2_local_span, 0).zw;
                // render_smooth(distance(uv, data_point), 1.5 * width, foreground_color2);
                render_smooth(distance(uv, data_point), 2. * width, foreground_color3);
                data_point = bspline2_val(s2_t1 - 1., local_cp, s2_local_span, 0).zw;
            }

            if(k == 0) {
                data_point = knot_point;
                render_smooth(distance(uv, data_point), 2. * width, foreground_color3);
                data_point = bspline2_val(t0 + 1., local_cp, s2_local_span, 0).zw;
            } else if(k < seg_size - 1) {
                data_point = bspline2_val(.5 * (t0 + s2_t1), local_cp, s2_local_span, 0).zw;
            }
            render_smooth(distance(uv, data_point), 2. * width, foreground_color3);
        }

        // and control points
        for(uint i = 0u; i < control_point_size; ++i) {
            render_smooth(distance(uv, control_point[i].zw), width, foreground_color4);
        }
    }
}
