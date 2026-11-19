import type { ExerciseContent } from '../types';

export const CONTENT_LOWER: Record<string, ExerciseContent> = {
  back_squat: {
    summary: 'The classic barbell squat for quads and glutes; a main strength lift for the whole lower body and trunk.',
    steps: [
      'Set the bar at upper-chest height in the rack, duck under it and place it across your upper back, not on your neck. Grip firmly and unrack.',
      'Step back, set feet about shoulder width with toes slightly out, take a big breath and brace your trunk.',
      'Sit down and slightly back, letting hips and knees bend together while your knees track in line with your toes.',
      'Descend to a depth you can control with a flat back and heels down.',
      'Drive up through the whole foot, keeping chest and hips rising together, and exhale near the top.',
      'Walk the bar back into the rack before you let go.',
    ],
    cues: ['Brace, sit between the hips', 'Knees track over toes', 'Whole foot on the floor', 'Chest and hips rise together'],
    goodToKnow: [
      'Set the safety bars just below your bottom position so a missed rep is never a problem. Squat inside a rack when going heavy.',
      'Common faults: hips shooting up first, knees caving in, heels lifting. Lower the load or use a goblet squat to groove the pattern.',
      'If the bar is uncomfortable on your back, try a thicker pad or a slightly lower bar position. Front squat is a sensible variation.',
      'If something hurts (not just muscle effort), stop the set, cut load or depth, and see a qualified professional if it persists.',
    ],
  },
  front_squat: {
    summary: 'A barbell squat with the bar on the front of your shoulders, biasing the quads and demanding an upright trunk.',
    steps: [
      'Set the bar at upper-chest height. Place it on your front delts, fingertips under the bar, elbows high, or cross your arms over it.',
      'Unrack, step back, set feet about shoulder width and brace your trunk.',
      'Sit straight down, keeping elbows high and chest tall as the knees travel forward over the toes.',
      'Go as deep as you can while staying upright and keeping heels down.',
      'Drive up leading with the chest, keeping elbows up, then rack the bar.',
    ],
    cues: ['Elbows high', 'Stay tall through the chest', 'Push the floor away'],
    goodToKnow: [
      'If your elbows drop the bar will roll forward. Reduce load, and work on wrist and upper back mobility if the rack position is painful.',
      'Expect to use a noticeably lighter load than a back squat. Add load gradually.',
      'Dump the bar forward to safety if you fail; do not try to hold on and fold over. Use safety bars in the rack.',
    ],
  },
  smith_squat: {
    summary: 'A squat on a guided bar that lets you focus on pushing hard with the legs with less balance demand.',
    steps: [
      'Set the bar at upper-chest height, step under it and rest it on your upper back. Twist to unhook it.',
      'Place your feet slightly in front of the bar so your knees can bend without your torso collapsing forward.',
      'Brace, then sit down until thighs reach a depth you can control, keeping heels flat.',
      'Press up through the whole foot, then twist the bar to rehook it on the safety catches.',
    ],
    cues: ['Feet a little forward of the bar', 'Heels down', 'Control the way down'],
    goodToKnow: [
      'The fixed bar path can feel awkward for some. Adjust foot position until the movement feels smooth on the knees and hips.',
      'Learn where the safety catches are and set them below your bottom position before loading up.',
      'If a free-weight squat feels stable for you, a back squat is a natural progression; the machine is also a good place to build volume.',
    ],
  },
  leg_press: {
    summary: 'A machine press that loads quads and glutes with the back supported, good for volume with little balance demand.',
    steps: [
      'Sit with your back and hips flat against the pad. Place feet shoulder width apart in the middle of the platform.',
      'Release the safeties and hold the handles with the legs straight but knees not locked.',
      'Lower the platform under control until your knees are bent deeply, stopping before your hips tuck or lift off the seat.',
      'Press through the whole foot back up, stopping just short of locking out.',
      'Re-engage the safeties when the set is done.',
    ],
    cues: ['Hips glued to the seat', 'Do not lock out the knees', 'Push through the whole foot'],
    goodToKnow: [
      'If your lower back rounds off the pad at the bottom, shorten the range of motion. That is the sign you have gone too deep.',
      'Higher foot placement leans on glutes more; lower placement shifts load to the quads. Change one thing at a time.',
      'Never rest your hands on your knees to push. Control the platform, especially when heavy and tired.',
    ],
  },
  hack_squat: {
    summary: 'A machine squat on an angled sled that targets the quads hard with a supported back.',
    steps: [
      'Step into the machine with your back and shoulders against the pad and feet shoulder width on the platform.',
      'Unlock the safeties and straighten your legs without locking the knees.',
      'Lower under control until your thighs are at least parallel or as deep as you can go with heels down.',
      'Drive up through the whole foot, then lock the safeties when finished.',
    ],
    cues: ['Heels down', 'Knees follow toes', 'Smooth and controlled on the way down'],
    goodToKnow: [
      'Feet lower and closer on the platform put more demand on the quads and knees. Move them up a little if your knees complain.',
      'Keep hips in contact with the pad. If they peel off at the bottom, reduce depth.',
      'Start lighter than you think; the sled path makes loads feel deceptively easy until the bottom.',
    ],
  },
  goblet_squat: {
    summary: 'A squat holding a dumbbell at the chest, ideal for learning depth and an upright torso or as light quad volume.',
    steps: [
      'Hold one dumbbell vertically at your chest, cupped in both hands under the top end, elbows pointing down.',
      'Set your feet just wider than shoulder width, toes slightly out, and brace your trunk.',
      'Sit straight down between your hips, letting your elbows travel inside your knees.',
      'Pause briefly at the bottom with a tall chest, then stand up by pushing the floor away.',
    ],
    cues: ['Chest tall', 'Elbows inside the knees', 'Sit between your hips'],
    goodToKnow: [
      'Use one dumbbell total; the weight is for counterbalance, so pick a load you can hold comfortably.',
      'If heels lift, try a slightly wider stance or put a small plate under the heels.',
      'When it gets easy, move on to a front squat or back squat, or slow the tempo for more challenge.',
    ],
  },
  bulgarian_split: {
    summary: 'A single-leg squat with the rear foot raised on a bench, building quads, glutes and balance one side at a time.',
    steps: [
      'Stand about a long stride in front of a bench, holding a dumbbell in each hand. Rest the top of one rear foot on the bench.',
      'Keep your front foot flat and your torso tall or leaning slightly forward with a braced trunk.',
      'Bend both knees and lower straight down until the front thigh is about parallel, front heel down.',
      'Push through the whole front foot to stand back up.',
      'Finish all reps, then switch legs.',
    ],
    cues: ['Front foot planted', 'Drop straight down', 'Torso tall, hips square'],
    goodToKnow: [
      'Each leg is trained separately, and the dumbbells are per hand. Do the weaker side first and match reps on the other.',
      'If your front knee or the rear foot hurts, adjust your stance distance and bench height first. Starting without weights is fine.',
      'Balance usually wobbles at first. Reduce load until you can control the descent.',
    ],
  },
  walking_lunge: {
    summary: 'A lunge performed while stepping forward each rep, working quads, glutes and coordination.',
    steps: [
      'Hold a dumbbell in each hand at your sides and stand tall with your trunk braced.',
      'Step forward with one leg and plant the whole foot, landing under control.',
      'Lower the back knee toward the floor with the front shin roughly vertical.',
      'Press through the front foot and bring the back leg forward into the next step.',
      'Keep alternating legs, turning around when you run out of space.',
    ],
    cues: ['Long, steady steps', 'Back knee drops straight down', 'Stay tall'],
    goodToKnow: [
      'Dumbbell weight is per hand. Count steps for each leg so the volume stays even.',
      'Very short steps load the knee; very long ones strain the hips. Find a stride where the front shin stays upright.',
      'If balance is a problem, try the reverse lunge or do the reps in place first.',
    ],
  },
  reverse_lunge: {
    summary: 'A lunge stepping backward, which is easier on the front knee and is a controlled way to train quads and glutes one side at a time.',
    steps: [
      'Hold a dumbbell in each hand at your sides, feet hip width, trunk braced.',
      'Step one foot back, landing on the ball of the foot with your front foot staying flat.',
      'Lower the back knee toward the floor, keeping most of your weight on the front leg.',
      'Drive through the front foot to return the back foot to the start.',
      'Complete your reps on one leg, then switch, or alternate sides each rep.',
    ],
    cues: ['Step back, not down', 'Front heel stays heavy', 'Torso upright'],
    goodToKnow: [
      'Load is per hand. Keep the dumbbells hanging at your sides so they do not swing.',
      'A good first lunge variation for people whose knees dislike stepping forward. Bodyweight is a fine place to start.',
      'Take a step long enough that the front knee stays roughly above the ankle at the bottom.',
    ],
  },
  step_up: {
    summary: 'Stepping onto a box with one leg doing the work, an approachable single-leg exercise for quads and glutes.',
    steps: [
      'Hold a dumbbell in each hand and stand facing a sturdy box or bench, with a height that lets your knee bend roughly 90 degrees.',
      'Place one whole foot on the box and shift your weight onto it.',
      'Drive through that foot to stand fully tall on the box, using the trailing leg only for balance.',
      'Lower back down slowly, controlling the descent with the working leg.',
      'Finish your reps on one side, then switch.',
    ],
    cues: ['Push through the top foot', 'Do not bounce off the back leg', 'Lower slowly'],
    goodToKnow: [
      'Per-leg exercise with dumbbells held in each hand. Choose a box height you can control; lower is easier on the knee.',
      'Make sure the box cannot slide or tip. Do not use a surface that is wobbly.',
      'To progress, use a higher box, a slower descent, or move to the Bulgarian split squat.',
    ],
  },
  leg_ext: {
    summary: 'A machine knee extension that isolates the quads with little demand on balance or the lower back.',
    steps: [
      'Adjust the seat so your knees line up with the machine pivot and the pad rests on your lower shins just above the ankles.',
      'Sit back against the pad and hold the handles.',
      'Extend your legs until they are straight, squeezing the quads at the top without slamming.',
      'Lower slowly back to the start without letting the stack crash.',
    ],
    cues: ['Squeeze the quads at the top', 'Lower slowly', 'Hips stay down'],
    goodToKnow: [
      'Avoid swinging or lifting your hips to complete reps. If you need to, the load is too heavy.',
      'If you feel pain at the front of the knee, shorten the range, lower the load, or swap to a leg press, and see a professional if it persists.',
      'Light-to-moderate loads with a controlled tempo work well for this isolation lift.',
    ],
  },
  rdl: {
    summary: 'A barbell hip hinge that loads the hamstrings and glutes through a long range, with the bar kept close to the legs.',
    steps: [
      'Stand holding the bar at hip height with an overhand grip, feet hip width and knees softly bent.',
      'Brace your trunk, then push your hips straight back while the bar slides down your thighs.',
      'Stop when you feel a firm stretch in the hamstrings, usually around mid-shin, with your back neutral.',
      'Drive your hips forward to stand tall, squeezing your glutes, and finish without leaning back.',
    ],
    cues: ['Hips back, not down', 'Bar drags along the legs', 'Long, neutral spine'],
    goodToKnow: [
      'Knees stay slightly bent and fixed; this is a hinge, not a squat. Depth is set by hamstring length, not by how low the bar goes.',
      'If your back rounds, reduce the range or lower the load. Use the dumbbell RDL to learn the pattern first.',
      'Use straps if grip fails before the legs do. Return the bar under control rather than dropping it.',
    ],
  },
  db_rdl: {
    summary: 'A dumbbell version of the hip hinge for hamstrings and glutes, one dumbbell in each hand, easy to learn and set up.',
    steps: [
      'Hold a dumbbell in each hand in front of your thighs, feet hip width, knees slightly bent.',
      'Brace, then push your hips back while the dumbbells slide down your legs.',
      'Lower until you feel a stretch in the hamstrings with your back flat, not rounded.',
      'Squeeze your glutes to drive your hips forward and stand tall.',
    ],
    cues: ['Send hips back', 'Dumbbells stay close', 'Back flat, chest proud'],
    goodToKnow: [
      'Weight is per hand. Keep the dumbbells brushing your legs to protect the lower back.',
      'Do not drop far beyond what your hamstring flexibility allows. Stop where the back would start to round.',
      'A great stepping stone to the Romanian deadlift once the pattern feels automatic.',
    ],
  },
  deadlift: {
    summary: 'The heavy conventional barbell pull from the floor that trains the whole posterior chain and grip.',
    steps: [
      'Stand with the bar over the middle of your feet, feet hip width. Hinge and bend your knees to grip the bar just outside your legs.',
      'Pull your chest up, set your back flat, and pull the slack out of the bar before it moves.',
      'Take a big breath, brace, and push the floor away while the bar rises along your legs.',
      'Stand fully tall, hips and knees locking out together, without leaning back.',
      'Reverse by pushing your hips back first, then bend your knees as the bar passes them, and lower it under control.',
    ],
    cues: ['Push the floor away', 'Bar stays against the legs', 'Brace before you pull', 'Lats tight, back flat'],
    goodToKnow: [
      'Common mistakes: bar drifting forward, hips shooting up first, and rounding the back. Reduce load until the setup repeats cleanly.',
      'Reset each rep from the floor rather than bouncing, and stop a set when your form degrades.',
      'If your back hurts, stop, lower the load or switch to a trap bar deadlift, and see a qualified professional if it persists.',
    ],
  },
  trap_deadlift: {
    summary: 'A deadlift inside a hex bar, which keeps the load beside your body and is often easier on the back to learn.',
    steps: [
      'Stand in the centre of the trap bar with feet hip width and grip the handles with arms straight.',
      'Hinge and bend your knees, lift your chest, and brace your trunk.',
      'Push the floor away, standing up with the bar close to your body.',
      'Stand tall with hips and knees extended together, then lower the bar in a controlled way back to the floor.',
    ],
    cues: ['Push the floor away', 'Chest up, shoulders over the handles', 'Brace first'],
    goodToKnow: [
      'Use the higher handles if you have limited mobility. Do not let your hips shoot up before the bar moves.',
      'Often a more squat-like pull. A good starting point before moving to the conventional deadlift.',
      'Put the bar down gently each rep. Drop it only if you absolutely need to, away from others.',
    ],
  },
  hip_thrust: {
    summary: 'A bench-supported hip extension that trains the glutes hard through the top of the lift.',
    steps: [
      'Sit on the floor with your upper back against a flat bench and roll the barbell over your hips, using a pad if needed.',
      'Plant your feet about hip width so your shins are near vertical at the top.',
      'Tuck your chin slightly, brace, and drive through your heels to lift your hips until they are in line with your shoulders and knees.',
      'Squeeze the glutes briefly, then lower under control until the bar is just above the floor.',
    ],
    cues: ['Chin tucked, ribs down', 'Drive through the heels', 'Squeeze the glutes at the top'],
    goodToKnow: [
      'If you arch your lower back at the top, stop short of full extension and focus on tucking the ribs down.',
      'A pad stops the bar from digging in. Ensure the bench is stable against a wall or heavy object.',
      'Feet too close or too far will shift load to the quads or hamstrings. Adjust until the glutes do the work.',
    ],
  },
  glute_bridge: {
    summary: 'A floor-based hip raise that teaches glute activation and is a gentle starter for the posterior chain.',
    steps: [
      'Lie on your back with knees bent and feet flat on the floor, about hip width, and arms by your sides.',
      'Brace gently and tuck your pelvis slightly.',
      'Push through your heels to lift your hips until your body forms a line from shoulders to knees.',
      'Pause and squeeze your glutes, then lower slowly.',
    ],
    cues: ['Push through the heels', 'Ribs down, do not arch', 'Squeeze at the top'],
    goodToKnow: [
      'If your hamstrings cramp, move your feet a little closer to your hips.',
      'When this feels easy, progress to the Glute bridge march, which adds a stability challenge.',
      'Lift only to where your glutes finish the movement; lifting higher with an arched back adds nothing.',
    ],
  },
  cable_pullthrough: {
    summary: 'A cable hip hinge facing away from the stack that grooves the hinge pattern and works glutes and hamstrings.',
    steps: [
      'Set the cable low with a rope attachment. Face away from the stack, straddle the cable and grab the rope between your legs.',
      'Walk forward until there is tension, with feet a little wider than hip width and knees slightly bent.',
      'Push your hips back, letting the rope travel behind you while your back stays flat.',
      'Drive your hips forward and squeeze your glutes to stand tall, keeping arms straight.',
    ],
    cues: ['Hips back, arms straight', 'Squeeze the glutes to stand', 'Do not lean back at the top'],
    goodToKnow: [
      'Arms are just hooks; the hips do the work. If you are pulling with your arms, you are hinging too little.',
      'Leaning back to finish means the load is too heavy or you are overextending.',
      'A friendly way to learn the hinge before heavier lifts like the Romanian deadlift.',
    ],
  },
  back_extension: {
    summary: 'A hinge on a 45-degree bench for the lower back and glutes, using bodyweight or a held plate.',
    steps: [
      'Adjust the pad so it sits below your hip bones and your feet are secured.',
      'Cross your arms on your chest or hold a plate there, and start with a straight line from head to heels.',
      'Hinge forward at the hips, keeping your back neutral, until you feel a hamstring stretch.',
      'Squeeze your glutes to return to a straight line, no further.',
    ],
    cues: ['Hinge at the hips', 'Stop at a straight line', 'Squeeze the glutes up'],
    goodToKnow: [
      'Do not hyperextend at the top; leaning back past a straight line stresses the spine instead of the target muscles.',
      'Pad too high makes you fold at the waist. Set it so your hips can hinge freely.',
      'Add load by holding a plate at the chest once bodyweight reps feel controlled.',
    ],
  },
  seated_leg_curl: {
    summary: 'A machine hamstring curl performed seated, a stable isolation exercise with the hips held flexed.',
    steps: [
      'Adjust the seat and back pad so your knees line up with the machine axis and the pad sits just above your heels.',
      'Secure the thigh pad firmly and hold the handles.',
      'Curl your heels down and back toward the seat as far as you comfortably can.',
      'Pause, then return slowly under control without letting the stack slam.',
    ],
    cues: ['Heels to the seat', 'Hips stay down', 'Slow on the way back'],
    goodToKnow: [
      'Do not lift your hips or lean forward to cheat the last reps. Reduce load if you need to.',
      'The seated position keeps the hamstrings lengthened, which many lifters find effective for the hamstrings.',
      'If you feel cramping, slow down and shorten the range slightly. Stop if you feel sharp pain.',
    ],
  },
  lying_leg_curl: {
    summary: 'A machine hamstring curl face down, trained with a steady tempo and no momentum.',
    steps: [
      'Lie face down and line up your knees just beyond the edge of the bench, with the roller on the lower calves above the heels.',
      'Grip the handles and keep your hips pressed to the bench.',
      'Curl your heels toward your glutes in a smooth arc.',
      'Pause briefly at the top, then lower slowly to nearly straight.',
    ],
    cues: ['Hips pressed down', 'Curl smoothly, no jerk', 'Lower for a count'],
    goodToKnow: [
      'If your hips pop up, the load is too heavy. Reduce it and slow the tempo.',
      'Point your toes loosely and avoid letting them dominate the movement. The effort should be in the back of the thigh.',
      'Hamstring cramps are common when new; start light and build gradually.',
    ],
  },
  nordic_curl: {
    summary: 'An advanced bodyweight exercise where you lower your torso forward with feet anchored, hard on the hamstrings.',
    steps: [
      'Kneel on a pad with your ankles firmly secured under a bar or held by a partner, body straight from knees to head.',
      'Brace your glutes and trunk so your hips stay extended.',
      'Lower your torso slowly toward the floor, resisting as long as you can.',
      'Catch yourself with your hands, then push back up, using your arms as needed.',
    ],
    cues: ['Straight line from knees to head', 'Resist the fall', 'Glutes squeezed'],
    goodToKnow: [
      'Very demanding on hamstrings. Start with a few slow reps and build gradually, as soreness can be heavy.',
      'If you cannot control the lowering at all, use a band or hold something for assistance, or use the Swiss-ball leg curl instead.',
      'Stop the set when you can no longer keep hips extended. Stop if you feel a sharp pull in the back of the thigh.',
    ],
  },
  swiss_curl: {
    summary: 'A hamstring curl with heels on a stability ball and hips lifted, training hamstrings, glutes and trunk control together.',
    steps: [
      'Lie on your back with your heels on top of a stability ball and legs straight.',
      'Lift your hips to form a straight line from shoulders to heels.',
      'Keeping the hips up, curl the ball toward your glutes by bending your knees.',
      'Extend your legs again slowly, still without letting your hips sag.',
    ],
    cues: ['Hips high the whole time', 'Roll the ball in smoothly', 'Slow on the return'],
    goodToKnow: [
      'If your hips sag, make it easier by doing just the bridge hold, then curl a short range.',
      'Press your arms into the floor for balance. Make sure the ball is the right size and fully inflated.',
      'It is a good step before the Nordic curl for lifters building hamstring strength.',
    ],
  },
  calf_raise_standing: {
    summary: 'A machine calf raise standing, to train the calf muscles through a full range.',
    steps: [
      'Position your shoulders under the pads, with the balls of your feet on the platform and heels hanging off.',
      'Stand tall with your knees almost straight and release the safety.',
      'Lower your heels as far as is comfortable for a stretch.',
      'Rise as high as you can onto your toes, pause, then lower slowly.',
    ],
    cues: ['Full stretch at the bottom', 'Pause at the top', 'No bouncing'],
    goodToKnow: [
      'The calves respond to full range and a controlled pause, not speed. Drop the load if you bounce out of the bottom.',
      'Keep your knees almost straight but not locked.',
      'Pain in the Achilles area means stop, reduce load and range, and see a professional if it persists.',
    ],
  },
  calf_raise_bw: {
    summary: 'A single-leg calf raise with bodyweight, a simple way to train calf strength anywhere.',
    steps: [
      'Stand on one foot on the edge of a step, holding a wall or rail for balance.',
      'Let your heel drop below the step for a controlled stretch.',
      'Push up through the ball of the foot as high as you can.',
      'Pause at the top, then lower slowly. Complete your reps, then switch legs.',
    ],
    cues: ['Rise tall onto the big toe', 'Slow lowering', 'Full range'],
    goodToKnow: [
      'Each leg is trained separately, so do equal reps on both sides.',
      'Use the support only for balance. Hold a dumbbell in the free hand or slow the tempo to progress.',
      'If this is too hard, do it with two feet and shift to one as you get stronger.',
    ],
  },
  hip_abduction: {
    summary: 'A seated machine that pushes the knees outward to target the outer glutes.',
    steps: [
      'Sit upright with your back against the pad and place your legs against the outer pads.',
      'Set the starting width so you feel a mild stretch without discomfort.',
      'Press your knees apart in a smooth motion until you reach a comfortable end range.',
      'Pause, then return slowly to the start without letting the stack drop.',
    ],
    cues: ['Press out with the knees', 'Do not rock the torso', 'Control the return'],
    goodToKnow: [
      'Leaning forward shifts the work toward different glute fibres. Try both and see what you feel, but stay consistent.',
      'Light weight with higher reps suits this isolation machine. Do not use momentum.',
      'Reduce range if you feel pinching at the hip, and consult a professional if it persists.',
    ],
  },
  kb_swing: {
    summary: 'An explosive hip hinge with a kettlebell, building glute and hamstring power and conditioning.',
    steps: [
      'Stand with feet slightly wider than shoulder width, the kettlebell on the floor a short distance ahead of you.',
      'Hinge and grab the handle with both hands, then hike the bell back between your legs.',
      'Snap your hips forward explosively so the bell floats up to about chest height, arms relaxed.',
      'Let it fall back, guiding it between your legs as you hinge again.',
      'Finish the set by parking the bell on the floor in front of you.',
    ],
    cues: ['Snap the hips, arms just hang on', 'Hinge, do not squat', 'Stand tall, squeeze glutes'],
    goodToKnow: [
      'The power comes from the hips, not the arms or lifting with the shoulders. If the bell goes much above chest height, you are lifting.',
      'Choose a bell light enough to keep a flat back through the whole set. Stop when your form fades.',
      'Do not try to catch the bell with a rounded back. A hinge pattern like the dumbbell RDL is a good way to learn first.',
    ],
  },
  tibialis_raise: {
    summary: 'A bodyweight raise of the toes that strengthens the shin muscle, useful for ankle balance and a warm-up or accessory.',
    steps: [
      'Lean your back against a wall with your feet a little in front of you, about a foot or so away.',
      'Keep your legs straight and your heels on the floor.',
      'Pull your toes up toward your shins as high as you can.',
      'Pause briefly, then lower slowly. Repeat for reps.',
    ],
    cues: ['Heels stay down', 'Toes up toward the shins', 'Slow lowering'],
    goodToKnow: [
      'Moving your feet farther from the wall makes it harder, and moving closer makes it easier.',
      'You will feel a burn in the front of the shin; that is normal. Sharp or lasting shin pain means stop and see a professional.',
      'Light, higher-rep work suits this, and it fits well before squats or running.',
    ],
  },
};
