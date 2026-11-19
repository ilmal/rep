import type { ExerciseContent } from '../types';

export const CONTENT_BODYWEIGHT: Record<string, ExerciseContent> = {
  wall_pushup: {
    summary: 'A beginner push-up against a wall that trains the chest, front shoulders and triceps with very little load; a gentle way to build toward floor push-ups.',
    steps: [
      'Stand about an arm and a half from a wall and place your palms on it at chest height, a little wider than your shoulders.',
      'Step your feet back slightly and tighten your stomach and glutes so your body forms one straight line from head to heels.',
      'Bend your elbows and lower your chest toward the wall, keeping your elbows angled about 45 degrees from your sides.',
      'Press the wall away until your arms are straight, without letting your hips sag or poke back.',
    ],
    cues: ['One straight line, head to heels', 'Chest to the wall, not nose', 'Elbows angled back, not flared'],
    goodToKnow: [
      'The further your feet are from the wall, the harder it gets. Step back a little each session before changing exercise.',
      'Once you reach the top of the rep range with a slow 3 s lowering, move on to Push-ups on the floor.',
      'Keep your wrists comfortable by spreading your fingers wide. If a wrist or shoulder hurts, shorten the range, and see a qualified professional if pain persists.',
    ],
  },
  diamond_pushup: {
    summary: 'A close-hand push-up that shifts the work toward the triceps while still using the chest; use it once regular push-ups feel comfortable.',
    steps: [
      'Start in a high plank and bring your hands together under your chest so your thumbs and index fingers form a diamond shape.',
      'Set your feet about hip width apart, squeeze your glutes and brace your stomach so your body is a straight plank.',
      'Lower your chest toward your hands, keeping your elbows close to your ribs rather than flaring out.',
      'Press the floor away until your arms are straight, keeping your hips level throughout.',
    ],
    cues: ['Elbows brushing your ribs', 'Hips and shoulders move together', 'Push the floor away'],
    goodToKnow: [
      'Close hands load the wrists and elbows more. If it hurts, drop to Push-ups with hands at shoulder width or place your knees down.',
      'If a full diamond is awkward, bring the hands only as close as feels comfortable; a narrower-than-shoulder grip still works.',
      'Breathe in on the way down and out as you press up. When you can do all sets with a slow 3 s lowering, try Archer push-up.',
    ],
  },
  archer_pushup: {
    summary: 'A wide-handed push-up where one arm does most of the work while the other stays straight; a bridge toward one-arm push-ups for strong lifters.',
    steps: [
      'Start in a high plank with your hands set much wider than your shoulders and your fingers pointing forward or slightly out.',
      'Brace your core, then bend one elbow and shift your chest over that hand while the other arm stays long and straight.',
      'Lower until your chest is near the floor over the working arm, keeping your hips level.',
      'Press back up through the working hand, return to the centre, then repeat on the other side.',
    ],
    cues: ['Chest over the bending arm', 'Straight arm is a kickstand only', 'Keep your hips level'],
    goodToKnow: [
      'Count one rep per side and alternate sides, or finish all reps on one side first; just keep both sides equal over the session.',
      'It stresses the shoulders and elbows more than a normal push-up. Work up from Diamond push-up and Push-ups first, and stop if you feel sharp joint pain.',
      'To make it easier, bend the straight arm a little or place your knees down. Do not let your hips twist toward the working side.',
    ],
  },
  pike_pushup: {
    summary: 'A push-up with your hips high that moves the load onto the shoulders; the main floor-only builder for overhead pressing strength.',
    steps: [
      'Start in a plank, then walk your feet in and lift your hips high so your body makes an upside-down V with your arms straight.',
      'Set your hands slightly wider than shoulder width and keep your legs as straight as comfortable.',
      'Bend your elbows and lower the top of your head toward the floor between your hands, elbows tracking back and out at a slight angle.',
      'Press through your palms to return to the start, keeping your hips high the whole time.',
    ],
    cues: ['Hips high, like a mountain peak', 'Head travels between the hands', 'Press tall at the top'],
    goodToKnow: [
      'Do it on a mat or carpet, not on a slippery floor, and lower slowly so your head does not bump the ground.',
      'Walk your feet closer to your hands to make it harder. If you feel it in the wrists, press through the whole palm and shorten the range.',
      'Once you can do a slow 3 s lowering for all reps, progress to Wall handstand hold. Stop the set if you feel shoulder pain, and see a qualified professional if it persists.',
    ],
  },
  wall_handstand: {
    summary: 'A supported handstand hold against a wall that builds overhead shoulder strength and body tension; the hardest shoulder skill in this list.',
    steps: [
      'Clear the space around you and place a mat or carpet by the wall. Put your hands on the floor about 15 to 20 cm from the wall, shoulder width apart.',
      'Kick one leg up, then the other, until your heels or toes rest on the wall and your belly faces the wall.',
      'Push the floor away so your shoulders reach toward your ears, squeeze your glutes and legs, and keep a long, straight line.',
      'Hold, breathing steadily, and come down under control by lowering one leg at a time.',
    ],
    cues: ['Press the floor away', 'Ribs down, glutes tight', 'Look between your hands'],
    goodToKnow: [
      'Stop the hold when your back arches, your elbows bend or your shoulders sink, not just when the clock ends. A shorter clean hold beats a long sloppy one.',
      'Make sure nothing breakable or sharp is nearby, and learn to come down safely before holding long. Build up with Pike push-up first.',
      'Skip it if you have a wrist, neck or shoulder problem, or high blood pressure concerns. If anything hurts, stop and see a qualified professional if it persists.',
    ],
  },
  chair_dips: {
    summary: 'A triceps-focused dip using the edge of a chair or sofa, with some chest and front shoulder help; good for adding arm pressing volume at home.',
    steps: [
      'Place a very sturdy chair against a wall so it cannot slide, and sit on its front edge with your hands gripping the edge beside your hips.',
      'Walk your feet forward and slide your hips off the seat, with your knees bent for easier or legs straighter for harder.',
      'Bend your elbows straight back to lower your body until your upper arms are roughly parallel to the floor.',
      'Press through your palms to straighten your arms, keeping your shoulders down away from your ears.',
    ],
    cues: ['Elbows point straight back', 'Hips stay close to the chair', 'Shoulders away from the ears'],
    goodToKnow: [
      'Test the chair first. It must not tip or slide, so avoid wheeled or folding chairs. A sofa edge or a low stable bench also works.',
      'Do not drop deep if your front shoulders feel pinched; stop at a comfortable depth. Sharp shoulder pain means stop the set, and see a qualified professional if it persists.',
      'Bent knees make it easier, straight legs harder. Lower slowly for 3 s once the reps feel easy before making it harder.',
    ],
  },
  plank_tap: {
    summary: 'A high plank where you tap alternate shoulders, training the core to resist rotation while the shoulders stay stable.',
    steps: [
      'Get into a high plank with your hands under your shoulders and your feet set wider than hip width for balance.',
      'Brace your stomach and squeeze your glutes so your body is a straight line from head to heels.',
      'Lift one hand and tap the opposite shoulder, then place it back down with control.',
      'Alternate sides, keeping your hips as still as possible; one tap on each side counts as two reps.',
    ],
    cues: ['Hips quiet, like a tray of water', 'Feet wide to steady yourself', 'Slow taps beat fast taps'],
    goodToKnow: [
      'The common mistake is rocking the hips side to side. If that happens, widen your feet or slow down.',
      'Your supporting wrist and shoulder carry more load on each tap. If they ache, shorten the set or go back to Plank.',
      'Once it is smooth for all sets with slow taps, progress to Hollow hold for harder trunk work.',
    ],
  },
  towel_row: {
    summary: 'A horizontal pull using a towel looped around a door handle, training the lats, upper back and biceps without any equipment.',
    steps: [
      'Choose a heavy, solid door that opens away from you and closes firmly, or make sure it is latched shut. Loop a thick towel through the handle and hold both ends.',
      'Stand facing the door with your feet near it, then lean back with straight arms and a rigid body until the towel is taut.',
      'Pull your chest toward the door by driving your elbows back and squeezing your shoulder blades together.',
      'Lower yourself back under control until your arms are straight again.',
    ],
    cues: ['Pull the elbows to your back pockets', 'Body stays one straight plank', 'Shoulders down, not shrugged'],
    goodToKnow: [
      'Safety first: check the door is closed and latched and cannot swing toward you, and that the towel is not frayed or slippery. A door that opens toward you is dangerous.',
      'The more you lean back, the harder it is. Start more upright if you cannot keep your hips in line.',
      'Do not let your hips sag or your head poke forward. Stop if you feel sharp shoulder or elbow pain, and see a qualified professional if it persists.',
    ],
  },
  superman: {
    summary: 'A face-down hold that strengthens the muscles along the back of your body, helpful for posture and balancing lots of pushing and sitting.',
    steps: [
      'Lie face down on a mat with your arms stretched overhead and your legs straight, forehead resting lightly toward the floor.',
      'Gently squeeze your glutes, then lift your arms, chest and legs a few centimetres off the floor at the same time.',
      'Keep your neck long by looking at the floor just in front of your hands, not up at the wall.',
      'Hold while breathing normally, then lower slowly. Stop when you start to strain your neck or lower back.',
    ],
    cues: ['Reach long, not high', 'Squeeze glutes first', 'Keep your neck in line'],
    goodToKnow: [
      'You are holding for time. Stop when your form breaks, such as your neck cranking up or your lower back pinching, not only when the clock ends.',
      'A small lift is enough. Lifting as high as possible just compresses the lower back.',
      'If you feel pinching or pain in the lower back, lift only the arms or only the legs. See a qualified professional if discomfort persists.',
    ],
  },
  prone_y: {
    summary: 'A light face-down raise that wakes up the rear shoulders and the upper back; a good warm-up for pressing and pulling days.',
    steps: [
      'Lie face down with your forehead near the floor and your arms stretched out in front of you, wider than your head to form a Y.',
      'Turn your thumbs up toward the ceiling.',
      'Squeeze your shoulder blades gently down and together, then lift both arms a little off the floor without raising your head.',
      'Pause for a moment at the top, then lower slowly and repeat.',
    ],
    cues: ['Thumbs to the ceiling', 'Shoulders away from the ears', 'Small, slow, controlled lift'],
    goodToKnow: [
      'This is a light activation exercise, so use no weight and chase a clean squeeze rather than height. Shrugging up to your ears is the typical mistake.',
      'Keep your ribs and hips on the floor; do not arch your lower back to lift higher.',
      'If you feel a pinch at the front of the shoulder, narrow the Y or lift less. If pain continues, stop and see a qualified professional.',
    ],
  },
  wall_slide: {
    summary: 'A gentle mobility drill that trains the shoulders and upper back to reach overhead smoothly; use it as a warm-up or as shoulder prehab.',
    steps: [
      'Stand with your back against a wall, feet a short step forward, and gently flatten your lower back toward it.',
      'Place your arms against the wall with elbows bent about 90 degrees, like a goalpost, with the backs of your hands touching if you can.',
      'Slowly slide your arms up the wall as far as you can while keeping your back, elbows and wrists in contact.',
      'Slide back down under control until your elbows are near your sides, and repeat.',
    ],
    cues: ['Keep contact with the wall', 'Ribs down, do not arch', 'Smooth, slow, no shrugging'],
    goodToKnow: [
      'It is fine if you cannot keep every part touching the wall. Slide only as far as you can with good form, as flexibility improves over weeks.',
      'Breathe normally, and avoid forcing the range. Arching your back to gain height is the most common mistake.',
      'Pinching or sharp pain means stop and reduce the range. If it persists, see a qualified professional.',
    ],
  },
  towel_curl: {
    summary: 'An isometric biceps hold using a towel under your foot, giving a surprisingly hard arm workout with no equipment.',
    steps: [
      'Stand on the middle of a long towel with one foot and hold the two ends, one in each hand, with your arms hanging at your sides.',
      'Bend your elbows to about 90 degrees and pull up on the ends as if curling, so the towel goes tight against your foot.',
      'Pull hard enough to feel your biceps work, while keeping your shoulders down and your back tall.',
      'Hold steadily and breathe. Release slowly when your form breaks or the time is up.',
    ],
    cues: ['Pull up, foot pushes down', 'Elbows stay by your sides', 'Keep breathing during the hold'],
    goodToKnow: [
      'Hold for time and stop when you start leaning back, shrugging or holding your breath, not only when the clock ends.',
      'Use a long, thick towel that will not rip, and stand on a non-slip floor or wear shoes. Use a hand towel and it can slip.',
      'You can change the intensity by how hard you pull, so build the effort gradually and stop if you feel a sharp elbow or wrist pain.',
    ],
  },
  bw_good_morning: {
    summary: 'A hip hinge with hands behind the head that teaches you to load the hamstrings and glutes with a flat back, a base for deadlift-style moves.',
    steps: [
      'Stand with your feet hip width apart, knees slightly bent, and place your hands lightly behind your head with elbows wide.',
      'Brace your stomach and push your hips straight back as if closing a car door with your backside.',
      'Lean your torso forward with a flat back until you feel a stretch in the back of your thighs, without rounding your spine.',
      'Squeeze your glutes to drive your hips forward and return to standing tall.',
    ],
    cues: ['Hips go back, not down', 'Long spine, proud chest', 'Squeeze the glutes to stand'],
    goodToKnow: [
      'The most common mistake is bending the knees too much and squatting, or rounding the back. Keep the shins nearly vertical.',
      'Stop the descent when your back starts to round, even if you are not as low as you would like.',
      'Once it feels easy with slow 3 s lowering, move on to Single-leg RDL. If your lower back hurts, shorten the range and see a qualified professional if it persists.',
    ],
  },
  bw_squat: {
    summary: 'The basic squat pattern that trains the quads and glutes and is the foundation for every harder leg move in this list.',
    steps: [
      'Stand with your feet about shoulder width apart and toes turned out slightly, arms out in front for balance.',
      'Brace your stomach, then bend your knees and push your hips back and down at the same time.',
      'Lower until your thighs are about parallel to the floor, or as deep as you can keep your heels down and back flat.',
      'Press through your whole foot to stand up, finishing with your hips fully extended.',
    ],
    cues: ['Knees track over your toes', 'Heels stay glued down', 'Chest up, spine long'],
    goodToKnow: [
      'Common mistakes are heels lifting, knees collapsing inward and the torso folding forward. A slightly wider stance often helps.',
      'If you cannot reach depth, squat to a chair and tap it lightly. Depth improves with practice.',
      'When all sets are easy, slow the lowering to 3 s, or move to Tempo squat. If your knees hurt, reduce the depth and see a qualified professional if it persists.',
    ],
  },
  tempo_squat: {
    summary: 'A squat with a slow lowering and a pause at the bottom that increases time under tension and builds control and leg strength without any weight.',
    steps: [
      'Stand with your feet shoulder width apart and your arms out in front for balance.',
      'Take about 3 seconds to lower yourself, pushing your hips back and bending your knees under control.',
      'Pause for a moment at the bottom with your chest up and your knees tracking over your toes.',
      'Drive up quickly through your whole foot to stand tall, then start the next slow descent.',
    ],
    cues: ['Count three on the way down', 'Stay tight in the pause', 'Stand up with intent'],
    goodToKnow: [
      'Do not bounce out of the bottom or relax in the pause; the tension is the point. If you collapse, shorten the pause.',
      'Breathe in on the way down, and out as you stand. Do not hold your breath during the pause.',
      'When this is easy, work toward Pistol squat via Split squat. If your knees hurt, reduce the depth and see a qualified professional if it persists.',
    ],
  },
  pistol_squat: {
    summary: 'A deep one-legged squat that demands serious leg strength, balance and mobility; an advanced goal for bodyweight training.',
    steps: [
      'Stand near a wall or door frame for light support, and lift one leg out in front of you, staying balanced on the other foot.',
      'Reach your arms forward and sit your hips back, bending the standing knee slowly while the free leg stays straight and off the floor.',
      'Lower as far as you can keep control and keep your heel flat, ideally to deep depth.',
      'Drive through your whole foot to stand back up, then repeat. Complete all reps on one leg before switching, so each leg gets the same work.',
    ],
    cues: ['Heel stays flat', 'Reach forward as a counterweight', 'Control the whole way down'],
    goodToKnow: [
      'Do it per leg and keep both legs equal. Clear the area around you and use a mat or non-slip floor in case you lose balance.',
      'It is hard on the knees and ankles. If you cannot control the lowering, sit down to a low chair or stay in Split squat until you are stronger.',
      'Stop the set if you feel sharp knee pain, and see a qualified professional if it persists. Do not bounce out of the bottom.',
    ],
  },
  single_leg_rdl: {
    summary: 'A one-legged hip hinge that strengthens the hamstrings and glutes while training balance and hip stability, one leg at a time.',
    steps: [
      'Stand on one foot with a soft bend in the knee, hands by your sides or reaching toward the floor.',
      'Brace your stomach, then hinge forward at the hip while your free leg extends straight behind you as a counterbalance.',
      'Keep your back flat and your hips square to the floor until you feel a stretch in the hamstring of the standing leg.',
      'Squeeze your glute to bring your torso upright and your leg back down, then finish all reps before switching legs.',
    ],
    cues: ['Hips stay square to the floor', 'Back leg and torso move together', 'Long spine, soft knee'],
    goodToKnow: [
      'Do each leg, and start by lightly touching a wall or chair with your fingertips if balance is tricky; it is not cheating.',
      'Do not twist the hips open or round the back to reach lower. Range is set by where you can stay flat, not by the floor.',
      'Move on once balance is solid with slow 3 s lowering. If your lower back or hamstring hurts sharply, stop and see a qualified professional if it persists.',
    ],
  },
  bw_reverse_lunge: {
    summary: 'A lunge stepping backward, which trains the quads and glutes and tends to be gentler on the knees than a forward lunge.',
    steps: [
      'Stand tall with your feet hip width apart and your hands on your hips or in front of you for balance.',
      'Step one foot back and lower until both knees bend to roughly 90 degrees, with your back knee hovering just above the floor.',
      'Keep your torso upright and your front heel planted, with the front knee in line with your toes.',
      'Push through your front foot to return to standing, then repeat on the other side or finish all reps on one leg first.',
    ],
    cues: ['Step back, drop straight down', 'Front heel stays grounded', 'Torso tall, hips square'],
    goodToKnow: [
      'Work each leg equally. Take a long enough step that your front shin stays about vertical.',
      'If balance is hard, stand beside a wall and lightly touch it. Wobbling is normal early on.',
      'Slow the lowering to 3 s once reps are easy, then try Split squat. If your knees hurt, reduce the depth and see a qualified professional if it persists.',
    ],
  },
  split_squat: {
    summary: 'A stationary lunge with your feet staggered, which builds single-leg strength in the quads and glutes and prepares you for Pistol squat.',
    steps: [
      'Take a long step forward and stand with your feet staggered, back heel lifted and both feet pointing forward, hands on your hips.',
      'Bend both knees to lower your hips straight down, until your front thigh is about parallel to the floor.',
      'Keep your torso upright and your front foot flat, with the back knee lowering toward the floor.',
      'Press through the front foot to rise back up without moving your feet, and finish all reps before switching legs.',
    ],
    cues: ['Drop straight down, not forward', 'Front foot rooted', 'Keep your torso tall'],
    goodToKnow: [
      'Do each leg. A longer stance works the glutes more, a shorter stance the quads.',
      'Hold a wall lightly for balance if needed. Do not let the front knee cave inward.',
      'Use a slow 3 s lowering once reps are easy, then progress toward Pistol squat. Stop if you get sharp knee pain, and see a qualified professional if it persists.',
    ],
  },
  lateral_lunge: {
    summary: 'A side-to-side lunge that trains the quads, glutes and inner thighs in a plane most workouts skip, plus hip mobility.',
    steps: [
      'Stand tall with your feet together or a little apart, toes pointing forward, and your hands in front of your chest.',
      'Take a big step out to the side and sit your hips back and down over that leg, keeping the other leg straight.',
      'Keep your chest up and the bent knee tracking over your toes, with your whole foot flat on the floor.',
      'Push through the bent leg to return to standing, then repeat on the same side or alternate sides.',
    ],
    cues: ['Sit back into the hip', 'Straight leg stays straight', 'Whole foot stays flat'],
    goodToKnow: [
      'Do both sides equally. Take a step only as wide as you can control; a wider step is not better.',
      'A slippery floor is risky for a side step, so use a mat or wear shoes with grip.',
      'You may feel a stretch in the inner thigh of the straight leg, which is normal. Sharp pain in the groin or knee means stop; see a qualified professional if it persists.',
    ],
  },
  glute_bridge_march: {
    summary: 'A glute bridge held at the top while you lift alternate feet, testing the glutes and core to keep the hips steady.',
    steps: [
      'Lie on your back with your knees bent, feet flat about hip width apart and arms resting by your sides.',
      'Press through your heels and lift your hips until your body makes a line from shoulders to knees.',
      'Holding that bridge, lift one foot a few centimetres off the floor as if marching, then place it down.',
      'Alternate feet while keeping your hips level and high, then lower your hips under control when the set ends.',
    ],
    cues: ['Hips level, no sagging', 'Ribs down, glutes squeezed', 'Small, slow marches'],
    goodToKnow: [
      'The common mistake is the hips dropping or rotating as a foot lifts. If they do, slow down or lift your foot less.',
      'Do not arch your lower back to get higher; squeeze the glutes instead. Rest if your hamstrings start to cramp, and push through the heels.',
      'When steady for all sets, progress to Single-leg glute bridge. If your back hurts, shorten the range and see a qualified professional if it persists.',
    ],
  },
  sl_glute_bridge: {
    summary: 'A glute bridge on one leg that strongly loads the glutes and hamstrings and tests hip stability on each side.',
    steps: [
      'Lie on your back with one knee bent and that foot flat on the floor, and extend the other leg straight, or hold it bent toward your chest.',
      'Brace your stomach and press through the heel of the planted foot to lift your hips.',
      'Rise until your body forms a straight line from shoulder to knee, keeping your hips level rather than tilted.',
      'Lower with control, tap lightly if you like, and complete all reps on one leg before switching.',
    ],
    cues: ['Drive through the heel', 'Hips stay level', 'Squeeze the glute at the top'],
    goodToKnow: [
      'Do each leg and note which side is weaker; start with that one. Both sides should do the same number of reps.',
      'Hamstring cramping is common; move your foot a bit closer to your hips and push through the heel.',
      'Pace the lowering at 3 s once reps are easy. If you feel your lower back instead of your glutes, shorten the lift, and see a qualified professional if pain persists.',
    ],
  },
  wall_sit: {
    summary: 'A static hold with your back against a wall and thighs parallel to the floor, building quad endurance and mental toughness without any movement.',
    steps: [
      'Stand with your back flat against a wall and walk your feet forward about a step and a half, hip width apart.',
      'Slide down until your thighs are roughly parallel to the floor and your knees are above your ankles.',
      'Keep your back flat on the wall and your arms hanging or crossed, not pushing on your thighs.',
      'Hold and breathe steadily, then slide back up. Stop when your form breaks, such as drifting upward or the knees caving in, not just when the clock ends.',
    ],
    cues: ['Knees over your ankles', 'Back flat on the wall', 'Breathe, do not hold it'],
    goodToKnow: [
      'The deeper you sit, the harder it gets. Start higher than parallel if you cannot hold the time with good form.',
      'Do not rest your hands on your thighs to take the load, and keep your weight through your heels.',
      'A burning feeling in the thighs is normal. Sharp pain in the knees is not: stop, stand up and see a qualified professional if it persists.',
    ],
  },
  jump_squat: {
    summary: 'An explosive squat that finishes with a jump, training leg power and fitness; best done fresh with a clean landing on every rep.',
    steps: [
      'Clear the space and stand with your feet shoulder width apart on a non-slip, flat floor, with shoes on.',
      'Lower into a quarter to half squat, swinging your arms back, with your chest up and heels down.',
      'Explode upward by driving through the floor and extending your hips, knees and ankles, and jump off the ground.',
      'Land softly on the middle of your feet with your knees bent, absorb the impact, and reset before the next jump.',
    ],
    cues: ['Land quiet, like a cat', 'Knees stay out, not in', 'Reset between reps'],
    goodToKnow: [
      'Landing is the risky part: bend the knees and hips, keep the knees in line with the toes, and never land stiff-legged.',
      'Stop the set when your landings get loud or sloppy from tiredness. Quality reps matter more than extra reps.',
      'Skip jumping if you have knee, ankle or back pain, or are returning from injury; do Tempo squat instead. See a qualified professional if pain persists.',
    ],
  },
  squat_to_pressup: {
    summary: 'A squat flowing into a push-up, giving a full-body, low-impact workout; a step toward the Burpee.',
    steps: [
      'Stand tall with your feet shoulder width apart and do a bodyweight squat with your chest up.',
      'At the bottom, place your hands on the floor in front of you and walk or step your feet back into a high plank.',
      'Do one push-up with your body in a straight line, then press back up to the plank.',
      'Walk or step your feet back in toward your hands, and stand up out of the squat to finish.',
    ],
    cues: ['Flat back in the plank', 'Move smoothly, not rushed', 'Step in, then stand tall'],
    goodToKnow: [
      'Do not let your hips sag when you reach the plank. If the push-up is too hard, do it from your knees or with a Wall push-up pattern in your other sets.',
      'Stepping rather than jumping your feet is easier on your wrists and back.',
      'When it feels smooth and strong, you can progress to Burpee. If wrists, shoulders or knees hurt, reduce the range and see a qualified professional if it persists.',
    ],
  },
  burpee: {
    summary: 'A full-body conditioning move that chains a squat, plank, push-up and jump; it raises your heart rate quickly and works legs, chest and core together.',
    steps: [
      'Clear the space and stand on a non-slip floor. Squat down and place your hands flat on the floor in front of you.',
      'Jump or step your feet back into a high plank, keeping your body in a straight line.',
      'Lower into a push-up, then press back up to the plank, keeping your hips from sagging.',
      'Jump or step your feet back under your hips, then jump up with your arms overhead and land softly.',
    ],
    cues: ['Hips never sag in the plank', 'Land softly, knees bent', 'Keep a steady rhythm'],
    goodToKnow: [
      'Stepping instead of jumping, and leaving out the push-up or the jump, are valid ways to scale it. Squat to press-up is the stepping stone.',
      'Stop the set when your plank sags or your landings get heavy from fatigue. Quality beats speed.',
      'Landing and the plank load the knees, wrists and lower back. Skip the jumps with joint pain, and see a qualified professional if it persists.',
    ],
  },
  hollow_hold: {
    summary: 'A tight, banana-shaped hold on your back that is a core of gymnastics training, building deep abdominal strength and full-body tension.',
    steps: [
      'Lie on your back on a mat with your arms stretched overhead and your legs straight and together.',
      'Press your lower back into the floor by tucking your pelvis slightly, and brace your stomach.',
      'Lift your shoulders, arms and legs a few centimetres off the floor, keeping your lower back glued down.',
      'Hold that shape and breathe steadily. Lower down when your lower back starts to lift or arch, not only when the clock ends.',
    ],
    cues: ['Lower back stays on the floor', 'Ribs pulled toward the hips', 'Reach long through fingers and toes'],
    goodToKnow: [
      'Make it easier by bending your knees or keeping your arms by your sides. Raise your legs higher to cut the load, lower to increase it.',
      'The key mistake is letting the lower back arch off the floor; if that happens, bring the legs up or bend the knees.',
      'Do not strain your neck: look at your toes with a relaxed jaw. Stop if your back hurts, and see a qualified professional if it persists.',
    ],
  },
  mountain_climber: {
    summary: 'A fast plank-based move that drives your knees toward your chest, raising your heart rate while training the core and hip flexors.',
    steps: [
      'Start in a high plank with your hands under your shoulders and your body in a straight line from head to heels.',
      'Brace your stomach, then drive one knee toward your chest while the other leg stays extended.',
      'Switch legs quickly, as if running in place on the floor, keeping your hips low and level.',
      'Keep a steady pace for the set and breathe rhythmically, stopping when your hips bounce up or your form falls apart.',
    ],
    cues: ['Shoulders over the hands', 'Hips low, no bouncing', 'Drive the knee to the chest'],
    goodToKnow: [
      'You work for time. End the set when your hips pike up or your back sags, not only when the clock ends. Slow down rather than flail.',
      'To make it easier, slow the pace or put your hands on a sturdy raised surface. Do not let your hands slide on a slippery floor.',
      'When this feels easy at a controlled pace, try Hollow hold for harder trunk work. If your wrists or shoulders hurt, stop and see a qualified professional if it persists.',
    ],
  },
};
