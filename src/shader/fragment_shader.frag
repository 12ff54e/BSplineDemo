#version 300 es
precision mediump float;

#define MAX_ARRAY_SIZE 1024

uniform vec2 canvas_size;
uniform float width;
uniform float dashing;
uniform uint control_point_size;
layout(std140) uniform spline_data {
    vec2 control_point[MAX_ARRAY_SIZE];
};

in vec3 color;
out vec4 frag_color;

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
vec2 bspline2_val(float t, vec2 cp[3], float span[4], int der) {
    const int order = 2;
    if(der > order) {
        return vec2(0.);
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

void render_smooth(float dist, float width, vec3 color) {
    if(dist < width * 1.5) {
        dist = smoothstep(width, width * 1.5, dist);
        frag_color = vec4(mix(color, frag_color.xyz, dist), 1.);
    }
}

// draw a 2nd order bspline (control points given by uniform variable `spline_data`)
void draw_bspline2(vec2 pt, vec3 color) {
    int seg_size = int(control_point_size) - 2;

    for(int k = 0; k < seg_size; ++k) {
        float t0 = k == 0 ? 0. : float(k) + .5;
        float t1 = k == seg_size - 1 ? float(seg_size + 1) : float(k) + 1.5;
        vec2[] local_cp = vec2[3](control_point[k], control_point[k + 1], control_point[k + 2]);
        float[] local_span = float[4](k <= 1 ? 0. : t0 - 1., t0, t1, k >= seg_size - 2 ? float(seg_size + 1) : t1 + 1.);
        vec2 p1 = bspline2_val(t0, local_cp, local_span, 0);

        // calculate derivatives
        vec2 dp1 = bspline2_val(t0, local_cp, local_span, 1);
        vec2 dp2 = bspline2_val(t0, local_cp, local_span, 2);
        float dist;
        if(k == seg_size - 1) {
            // last segment
            float arc_length;
            dist = dist_pt2quadratic(pt, mat3x2(p1, dp1, .5 * dp2), 0., t1 - t0, t1 - t0 - 1., arc_length);
            if(arc_length > 0. && int(arc_length / (.5 * dashing)) % 2 == 0) {
                dist = 10. * width; // dashing
            }
        } else {
            dist = dist_pt2quadratic(pt, mat3x2(p1, dp1, .5 * dp2), 0., t1 - t0);
        }

        // draw this segment
        render_smooth(dist, .5 * width, color);
    }
}

void main() {
    float aspect_ratio = canvas_size.x / canvas_size.y;
    vec2 uv = (gl_FragCoord.xy / canvas_size) - vec2(.5, 0.);
    uv.x *= aspect_ratio;
    // uv is normalized coordinate with y from 0 to 1 and x from -a/2 to a/2, 
    // starting from lower-left corner, where a is aspect ratio.
    // (Note: it depends on the qualifier `origin_upper_left` and `pixel_center_integer` of gl_FragCoord)

    // background being white
    vec3 background_color = color;
    // foreground being light blue (default color of mma's plot)
    vec3 foreground_color = vec3(0.368417, 0.506779, 0.709798);
    vec3 foreground_color2 = vec3(0.880722, 0.611041, 0.142051);
    vec3 foreground_color3 = vec3(0.560181, 0.691569, 0.194885);
    vec3 foreground_color4 = vec3(0.922526, 0.385626, 0.209179);
    frag_color = vec4(background_color, 1.0);

    if(control_point_size == 1u) {
        // draw a point
        render_smooth(distance(uv, control_point[0]), .5 * width, foreground_color);
    } else if(control_point_size == 2u) {
        // draw a line segment
        render_smooth(dist_pt2line(uv, control_point[0], control_point[1]), .5 * width, foreground_color);
    } else {
        // draw a bspline curve
        // render_smooth(dist_pt2bspline2(uv), .5 * width, foreground_color);
        draw_bspline2(uv, foreground_color);

        // and data points and knot points
        int seg_size = int(control_point_size) - 2;
        for(int k = 0; k < seg_size; ++k) {
            float t0 = k == 0 ? 0. : float(k) + .5;
            float t1 = k == seg_size - 1 ? float(seg_size + 1) : float(k) + 1.5;
            vec2[] local_cp = vec2[3](control_point[k], control_point[k + 1], control_point[k + 2]);
            float[] local_span = float[4](k <= 1 ? 0. : t0 - 1., t0, t1, k >= seg_size - 2 ? float(seg_size + 1) : t1 + 1.);

            vec2 knot_point = bspline2_val(t0, local_cp, local_span, 0);
            vec2 data_point;

            render_smooth(distance(uv, knot_point), 1.5 * width, foreground_color2);
            if(k == seg_size - 1) {
                data_point = bspline2_val(t1, local_cp, local_span, 0);
                render_smooth(distance(uv, data_point), 1.5 * width, foreground_color2);
                render_smooth(distance(uv, data_point), 2. * width, foreground_color3);
                data_point = bspline2_val(t1 - 1., local_cp, local_span, 0);
            }

            if(k == 0) {
                data_point = knot_point;
                render_smooth(distance(uv, data_point), 2. * width, foreground_color3);
                data_point = bspline2_val(t0 + 1., local_cp, local_span, 0);
            } else if(k < seg_size - 1) {
                data_point = bspline2_val(.5 * (t0 + t1), local_cp, local_span, 0);
            }
            render_smooth(distance(uv, data_point), 2. * width, foreground_color3);
        }

        // and control points
        for(uint i = 0u; i < control_point_size; ++i) {
            render_smooth(distance(uv, control_point[i]), width, foreground_color4);
        }
    }
}
