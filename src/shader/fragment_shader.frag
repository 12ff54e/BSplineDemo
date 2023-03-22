#version 300 es
precision mediump float;

uniform vec2 canvas_size;
in vec3 color;
out vec4 frag_color;

float ns(float x, vec2 pt0, float a) {
    float a2x2 = 2. * a * a * x * x;
    return x - (pt0.x + 2. * a2x2 * x) / (1. - 2. * a * pt0.y + 3. * a2x2);
}


// Distance from a point to a parabola y = a * x ^ 2 
float dist_pt2parabola(vec2 pt, float a) {
    float x0 = pt.y < 0. ? 0. : sqrt(pt.y / a);
    if(pt.x < 0.)
        x0 = -x0;

    // two iterates should be sufficent
    float x1 = x0 - ns(x0, pt, a);
    x1 = x1 - ns(x1, pt, a);
    return distance(pt, vec2(x1, a * x1 * x1));
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
    // construct rotation-translation matrix
    vec3 a = vec3(normalize(coef_mat[2]), 0.);
    float a_inv = inversesqrt(length(coef_mat[2]));
    float b_plus = .5 * dot(coef_mat[1], a.xy) * a_inv;
    float b_minus = cross(vec3(coef_mat[1], 0.), a).z * a_inv;
    float c_plus = dot(coef_mat[0], a.xy);
    float c_minus = cross(vec3(coef_mat[0], 0.), a).z;
    mat3 geo_tran = mat3(a, cross(a, vec3(0., 0., -1.)), vec3(b_plus * b_minus - c_minus, b_plus * b_plus - c_plus, 1.));
    vec3 tp = geo_tran * vec3(pt, 1.);

    return min(min(distance(pt, p1), distance(pt, p2)), dist_pt2parabola(tp.xy, 1. / (b_minus * b_minus)));
}

void main() {
    float aspect_ratio = canvas_size.x / canvas_size.y;
    vec2 uv = (gl_FragCoord.xy / canvas_size) - vec2(.5, 0.);
    uv.x *= aspect_ratio;
    // uv is normalized coordinate with y from 0 to 1 and x from -a/2 to a/2, 
    // starting from lower-left corner, where a is aspect ratio.
    // (Note: it depens on the qualifier `origin_upper_left` and `pixel_center_integer`)

    // background being white
    vec3 background_color = color;
    // frontground being light blue (default color of mma's plot)
    vec3 frontground_color = vec3(0.368417, 0.506779, 0.709798);
    vec3 frontground_color2 = vec3(0.880722, 0.611041, 0.142051);
    frag_color = vec4(background_color, 1.0);

    const float WIDTH = 0.005;
    const float SMOOTH = 0.0025;
    float dist = dist_pt2quadratic(uv, mat3x2(.2, 1.3, -2.7, -3.2, 3.5, 2.), 0., 1.);
    if(dist < WIDTH + SMOOTH) {
        dist = smoothstep(WIDTH, WIDTH + SMOOTH, dist);
        frag_color = vec4(mix(frontground_color, frag_color.xyz, dist), 1.);
    }
    dist = dist_pt2quadratic(uv, mat3x2(0.4, 0.2, -1.2, 0.84, 0.2, -0.14), 0., 1.);
    if(dist < WIDTH + SMOOTH) {
        dist = smoothstep(WIDTH, WIDTH + SMOOTH, dist);
        frag_color = vec4(mix(frontground_color2, frag_color.xyz, dist), 1.);
    }
}
