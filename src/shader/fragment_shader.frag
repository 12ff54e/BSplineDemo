#version 300 es
precision mediump float;

#define MAX_ARRAY_SIZE 1024

uniform vec2 canvas_size;
uniform int control_point_size;
layout(std140) uniform spline_data {
    vec2 control_point[MAX_ARRAY_SIZE];
};

in vec3 color;
out vec4 frag_color;

float ns(float x, vec2 pt0, float a) {
    float a2x2 = 2. * a * a * x * x;
    return x - (pt0.x + 2. * a2x2 * x) / (1. - 2. * a * pt0.y + 3. * a2x2);
}

// Distance from a point to a parabola y = a * x ^ 2 
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

float dist_pt2quadratic(vec2 pt, mat3x2 coef_mat, float t0, float t1) {
    const float eps = .00001;
    vec2 p1 = coef_mat * vec3(1., t0, t0 * t0);
    vec2 p2 = coef_mat * vec3(1., t1, t1 * t1);
    if(abs(cross(vec3(coef_mat[1], 0.), vec3(coef_mat[2], 0.)).z) < eps) {
        // treat as straight line
        return dist_pt2line(pt, p1, p2);
    }
    
    vec2 a = normalize(coef_mat[2]);
    mat2 rot = mat2(a.y, a.x, -a.x, a.y);
    float a_inv = inversesqrt(length(coef_mat[2]));
    vec2 bt = rot * coef_mat[1] * a_inv;
    vec2 ct = rot * coef_mat[0];
    mat3 geo_tran = mat3(rot);
    geo_tran[2] = vec3(.5 * bt.x * bt.y - ct.x, .25 * bt.y * bt.y - ct.y, 1.);
    vec3 tp = geo_tran * vec3(pt, 1.);

    float xp;
    float dist = dist_pt2parabola(tp.xy, 1. / (bt.x * bt.x), xp);
    if(((geo_tran * vec3(p1, 1.)).x - xp) * ((geo_tran * vec3(p2, 1.)).x - xp) > 0.) {
        // projection point outside segment range
        dist = min(distance(pt, p1), distance(pt, p2));
    }

    return dist;
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

// distance between a point and a 2nd order bspline (control points given by uniform variable `spline_data`)
float dist_pt2bspline2(vec2 pt) {
    int seg_size = control_point_size - 2;

    vec2 p1, p2;
    float dist = canvas_size.x;
    for(int k = 0; k < seg_size; ++k, p1 = p2) {
        float t0 = k == 0 ? 0. : float(k) + .5;
        float t1 = k == seg_size - 1 ? float(seg_size + 1) : float(k) + 1.5;
        vec2[] local_cp = vec2[3](control_point[k], control_point[k + 1], control_point[k + 2]);
        float[] local_span = float[4](k <= 1 ? 0. : t0 - 1., t0, t1, k >= seg_size - 2 ? float(seg_size + 1) : t1 + 1.);
        if(k == 0) {
            p1 = bspline2_val(t0, local_cp, local_span, 0);
        }
        p2 = bspline2_val(t1, local_cp, local_span, 0);
        if(distance(pt, p1) > 2. * distance(p1, p2)) {
            // pt too faraway
            dist = min(dist, min(distance(pt, p1), distance(pt, p2)));
        } else {
            // calculate derivatives
            vec2 dp1 = bspline2_val(t0, local_cp, local_span, 1);
            vec2 dp2 = bspline2_val(t0, local_cp, local_span, 2);
            dist = min(dist, dist_pt2quadratic(pt, mat3x2(p1, dp1, .5 * dp2), 0., t1 - t0));
        };
    }

    return dist;
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
    frag_color = vec4(background_color, 1.0);

    const float WIDTH = 0.005;
    const float SMOOTH = 0.0025;
    // float dist = dist_pt2quadratic(uv, mat3x2(.2, 1.3, -2.7, -3.2, 3.5, 2.), 0., .9);
    // if(dist < WIDTH + SMOOTH) {
    //     dist = smoothstep(WIDTH, WIDTH + SMOOTH, dist);
    //     frag_color = vec4(mix(foreground_color, frag_color.xyz, dist), 1.);
    // }
    // dist = dist_pt2quadratic(uv, mat3x2(0.4, 0.2, -1.2, 0.84, 0.2, -0.14), 0., 1.);
    // if(dist < WIDTH + SMOOTH) {
    //     dist = smoothstep(WIDTH, WIDTH + SMOOTH, dist);
    //     frag_color = vec4(mix(foreground_color2, frag_color.xyz, dist), 1.);
    // }
    float dist = dist_pt2bspline2(uv);
    if(dist < WIDTH + SMOOTH) {
        dist = smoothstep(WIDTH, WIDTH + SMOOTH, dist);
        frag_color = vec4(mix(foreground_color, frag_color.xyz, dist), 1.);
    }
}
