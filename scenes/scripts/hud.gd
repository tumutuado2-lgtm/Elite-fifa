extends Control

signal shoot_released(power: float)
signal pass_pressed
signal dribble_pressed
signal switch_pressed
signal screen_tapped

var move := Vector2.ZERO
var sprint := false
var score_a := 0
var score_b := 0
var time_text := "3:00"
var banner := ""
var stick_id := -1
var stick_pos := Vector2.ZERO
var touches := {}
var shoot_id := -1
var shoot_hold := 0.0
var font: Font

const RADIUS := {"Chute": 62.0, "Passe": 56.0, "Drible": 52.0, "Correr": 70.0, "Trocar": 48.0}
const STICK_R := 110.0

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	font = ThemeDB.fallback_font

func _stick_center() -> Vector2:
	return Vector2(190.0, size.y - 170.0)

func _btn_center(n: String) -> Vector2:
	var s := size
	match n:
		"Chute": return Vector2(s.x - 100.0, s.y - 260.0)
		"Passe": return Vector2(s.x - 235.0, s.y - 190.0)
		"Drible": return Vector2(s.x - 250.0, s.y - 60.0)
		"Correr": return Vector2(s.x - 100.0, s.y - 110.0)
		_: return Vector2(s.x - 370.0, s.y - 170.0)

func _hit_button(pos: Vector2) -> String:
	for n in RADIUS.keys():
		if pos.distance_to(_btn_center(n)) <= RADIUS[n] + 10.0:
			return n
	return ""

func _update_stick(pos: Vector2) -> void:
	var v := (pos - _stick_center()) / STICK_R
	v = v.limit_length(1.0)
	stick_pos = _stick_center() + v * STICK_R
	move = Vector2.ZERO if v.length() < 0.15 else v

func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		var pos: Vector2 = event.position
		if event.pressed:
			screen_tapped.emit()
			var hit := _hit_button(pos)
			if hit != "":
				touches[event.index] = hit
				_press(hit, event.index)
			elif stick_id == -1 and pos.x < size.x * 0.45:
				stick_id = event.index
				_update_stick(pos)
		else:
			if event.index == stick_id:
				stick_id = -1
				move = Vector2.ZERO
				stick_pos = _stick_center()
			elif touches.has(event.index):
				_release(touches[event.index])
				touches.erase(event.index)
	elif event is InputEventScreenDrag:
		if event.index == stick_id:
			_update_stick(event.position)

func _press(n: String, idx: int) -> void:
	match n:
		"Chute":
			shoot_id = idx
			shoot_hold = 0.0
		"Passe": pass_pressed.emit()
		"Drible": dribble_pressed.emit()
		"Correr": sprint = true
		"Trocar": switch_pressed.emit()

func _release(n: String) -> void:
	match n:
		"Chute":
			shoot_released.emit(clampf(shoot_hold / 0.7, 0.25, 1.0))
			shoot_id = -1
			shoot_hold = 0.0
		"Correr": sprint = false

func _process(delta: float) -> void:
	if shoot_id != -1:
		shoot_hold += delta
	if stick_id == -1:
		stick_pos = _stick_center()
	queue_redraw()

func _text(t: String, y: float, fs: int, col: Color) -> void:
	draw_string(font, Vector2(0, y), t, HORIZONTAL_ALIGNMENT_CENTER, size.x, fs, col)

func _draw() -> void:
	if font == null:
		return
	# placar
	var bx := size.x / 2.0 - 190.0
	draw_rect(Rect2(bx, 10, 380, 52), Color(0, 0, 0, 0.6))
	draw_string(font, Vector2(bx, 46), "AZU  %d - %d  VER   %s" % [score_a, score_b, time_text], HORIZONTAL_ALIGNMENT_CENTER, 380.0, 28, Color.WHITE)
	# joystick
	draw_circle(_stick_center(), STICK_R, Color(0, 0, 0, 0.35))
	draw_arc(_stick_center(), STICK_R, 0, TAU, 48, Color(1, 1, 1, 0.6), 3.0)
	draw_circle(stick_pos, 46.0, Color(1, 1, 1, 0.45))
	# botoes
	for n in RADIUS.keys():
		var c := _btn_center(n)
		var r: float = RADIUS[n]
		draw_circle(c, r, Color(0.1, 0.1, 0.1, 0.6))
		draw_arc(c, r, 0, TAU, 48, Color(1, 1, 1, 0.75), 3.0)
		draw_string(font, Vector2(c.x - r, c.y + 8.0), n, HORIZONTAL_ALIGNMENT_CENTER, r * 2.0, 22, Color.WHITE)
	# barra de forca do chute
	if shoot_id != -1:
		var cc := _btn_center("Chute")
		var p := clampf(shoot_hold / 0.7, 0.0, 1.0)
		draw_rect(Rect2(cc.x - 60, cc.y - 90, 120, 10), Color(0, 0, 0, 0.6))
		draw_rect(Rect2(cc.x - 60, cc.y - 90, 120 * p, 10), Color(1, 0.8, 0.1))
	# aviso central
	if banner != "":
		var lines := banner.split("\n")
		var y := size.y * 0.4
		for l in lines:
			_text(l, y, 48, Color(1, 1, 0.3))
			y += 60.0
