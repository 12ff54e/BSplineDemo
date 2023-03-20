#version 300 es
precision mediump float;

uniform vec2 canvas_size;
in vec3 color;
out vec4 frag_color;

float ns(float x, vec2 pt0, float a) {
    float a2x2 = 2. * a * a * x * x;
    return x - (pt0.x + 2. * a2x2 * x) / (1. - 2. * a * pt0.y + 3. * a2x2);
}

float dist_pt2parabola(vec2 pt, float a) {
    float x0 = pt.y < 0. ? 0. : sqrt(pt.y / a);
    if(pt.x < 0.)
        x0 = -x0;

    // two iterates should be sufficent
    float x1 = x0 - ns(x0, pt, a);
    x1 = x1 - ns(x1, pt, a);
    return length(pt - vec2(x1, a * x1 * x1));
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
    frag_color = vec4(background_color, 1.0);

    float WIDTH = 0.005;
    float SMOOTH = 0.0025;
    float dist = dist_pt2parabola(uv - vec2(0., .1), 3.);
    if(dist < WIDTH + SMOOTH) {
        dist = smoothstep(WIDTH, WIDTH + SMOOTH, dist);
        frag_color = vec4(mix(frontground_color, background_color, dist), 1.);
    }
}
