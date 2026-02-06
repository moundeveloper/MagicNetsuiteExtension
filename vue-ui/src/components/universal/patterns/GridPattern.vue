<template>
  <div class="sci-fi-background">
    <canvas ref="particleCanvas" class="particle-canvas"></canvas>
    <div class="content">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

const particleCanvas = ref<HTMLCanvasElement | null>(null);
let animationId: number | null = null;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  targetOpacity: number;
  fadeSpeed: number;
  swayAmplitude: number;
  swaySpeed: number;
  swayOffset: number;
}

onMounted(() => {
  if (!particleCanvas.value) return;

  const canvas = particleCanvas.value;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Set canvas size
  const setCanvasSize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  setCanvasSize();

  const resizeHandler = () => {
    setCanvasSize();
  };
  window.addEventListener("resize", resizeHandler);

  // Create particles
  const particles: Particle[] = [];
  const particleCount = 45;

  for (let i = 0; i < particleCount; i++) {
    const maxOpacity = Math.random() * 0.5 + 0.25;

    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: -(Math.random() * 0.3 + 0.2), // Move left 0.2 to 0.5
      vy: Math.random() * 0.3 + 0.2, // Move down 0.2 to 0.5
      size: Math.random() * 1.5 + 0.8,
      opacity: Math.random() * maxOpacity,
      targetOpacity: maxOpacity,
      fadeSpeed: Math.random() * 0.005 + 0.001,
      swayAmplitude: Math.random() * 10 + 5, // Subtle sway
      swaySpeed: Math.random() * 0.008 + 0.003,
      swayOffset: Math.random() * Math.PI * 2
    });
  }

  // Animation loop
  const animate = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach((particle) => {
      // Move diagonally from top-right to bottom-left
      particle.x += particle.vx;
      particle.y += particle.vy;

      // Add gentle sway perpendicular to the diagonal motion
      particle.swayOffset += particle.swaySpeed;
      const sway = Math.sin(particle.swayOffset) * particle.swayAmplitude;
      const currentX = particle.x + sway * 0.3;
      const currentY = particle.y - sway * 0.3;

      // Reset particle when it goes off screen - spread across entire diagonal entry line
      if (particle.x < -10 || particle.y > canvas.height + 10) {
        // Randomly position along the top and right edges
        const startFromTop = Math.random() > 0.5;

        if (startFromTop) {
          // Start from top edge, anywhere along width
          particle.x = Math.random() * canvas.width;
          particle.y = -10;
        } else {
          // Start from right edge, anywhere along height
          particle.x = canvas.width + 10;
          particle.y = Math.random() * canvas.height;
        }

        particle.swayOffset = Math.random() * Math.PI * 2;
      }

      // Fade in/out effect
      if (Math.abs(particle.opacity - particle.targetOpacity) < 0.01) {
        particle.targetOpacity =
          particle.targetOpacity > 0.1 ? 0 : Math.random() * 0.5 + 0.25;
      }

      if (particle.opacity < particle.targetOpacity) {
        particle.opacity += particle.fadeSpeed;
      } else {
        particle.opacity -= particle.fadeSpeed;
      }

      // Draw particle
      if (particle.opacity > 0.01) {
        ctx.shadowBlur = 3;
        ctx.shadowColor = `rgba(80, 80, 80, ${particle.opacity})`;
        ctx.fillStyle = `rgba(80, 80, 80, ${particle.opacity})`;
        ctx.beginPath();
        ctx.arc(currentX, currentY, particle.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    animationId = requestAnimationFrame(animate);
  };

  // Pause animation when tab is not visible
  const visibilityHandler = () => {
    if (document.hidden && animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    } else if (!animationId) {
      animate();
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);

  animate();

  onUnmounted(() => {
    if (animationId) cancelAnimationFrame(animationId);
    window.removeEventListener("resize", resizeHandler);
    document.removeEventListener("visibilitychange", visibilityHandler);
  });
});
</script>

<style scoped>
.sci-fi-background {
  position: relative;
  width: 100%;
  min-height: 100vh;
}

.particle-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  filter: blur(0.5px);
}

.content {
  position: relative;
  z-index: 2;
}
</style>
