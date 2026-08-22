import math
import random
import heapq
from mesa import Agent, Model
from mesa.space import ContinuousSpace
try:
    from mesa.time import RandomActivation
except ImportError:
    try:
        from mesa.time import BaseScheduler as RandomActivation
    except ImportError:
        # Mesa 3.x fallback: simple custom activation list wrapper
        class RandomActivation:
            def __init__(self, model):
                self.model = model
                self.agents = []
            def add(self, agent):
                self.agents.append(agent)
            def remove(self, agent):
                if agent in self.agents:
                    self.agents.remove(agent)
            def step(self):
                random.shuffle(self.agents)
                for agent in list(self.agents):
                    agent.step()

def find_path_astar(start_x, start_y, end_x, end_y, obstacles, congested_cells, width=100, height=100):
    scale = 2.0
    cols = 51
    rows = 51
    
    start_g = (round(start_x / scale), round(start_y / scale))
    end_g = (round(end_x / scale), round(end_y / scale))
    
    # clamp
    start_g = (max(0, min(cols - 1, start_g[0])), max(0, min(rows - 1, start_g[1])))
    end_g = (max(0, min(cols - 1, end_g[0])), max(0, min(rows - 1, end_g[1])))
    
    def get_cost(gx, gy):
        lx = gx * scale
        ly = gy * scale
        
        # 1. Static bottleneck obstacles
        if 44 <= lx <= 56:
            if ly >= 58 or ly <= 42:
                return float('inf')
                
        # 2. Dynamic operator-placed obstacles (Red zones)
        for obs in obstacles:
            dist = math.hypot(lx - obs["x"], ly - obs["y"])
            if dist <= obs["radius"]:
                return float('inf')
                
        # 3. Dynamic H3 congested hex zones
        for cell in congested_cells:
            dist = math.hypot(lx - cell["x"], ly - cell["y"])
            if dist <= 12.0:
                if cell["risk_level"] == "red":
                    return float('inf')
                elif cell["risk_level"] == "amber":
                    return 15.0
                    
        return 1.0

    # Priority queue: (f_score, g_score, current_node, parent_node)
    h_start = math.hypot(start_g[0] - end_g[0], start_g[1] - end_g[1])
    open_set = []
    heapq.heappush(open_set, (h_start, 0.0, start_g, None))
    
    g_score = {start_g: 0.0}
    parent_map = {}
    closed_set = set()
    
    dirs = [
        (0, 1), (1, 0), (0, -1), (-1, 0),
        (1, 1), (1, -1), (-1, 1), (-1, -1)
    ]
    
    iterations = 0
    while open_set and iterations < 1200:
        iterations += 1
        f, g, curr, parent = heapq.heappop(open_set)
        
        if curr in closed_set:
            continue
            
        closed_set.add(curr)
        
        if curr == end_g:
            # Reconstruct path
            path = []
            c = curr
            while c is not None:
                path.append((c[0] * scale, c[1] * scale))
                c = parent_map.get(c)
            path.reverse()
            return path
            
        cx, cy = curr
        for dx, dy in dirs:
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < cols and 0 <= ny < rows:
                neighbor = (nx, ny)
                if neighbor in closed_set:
                    continue
                    
                cost = get_cost(nx, ny)
                if cost == float('inf'):
                    continue
                    
                weight = 1.414 if (dx != 0 and dy != 0) else 1.0
                tentative_g = g + weight * cost
                
                if tentative_g < g_score.get(neighbor, float('inf')):
                    g_score[neighbor] = tentative_g
                    parent_map[neighbor] = curr
                    h = math.hypot(nx - end_g[0], ny - end_g[1])
                    heapq.heappush(open_set, (tentative_g + h, tentative_g, neighbor, curr))
                    
    return None

class PedestrianAgent(Agent):
    """An agent representing a pedestrian moving along A* path nodes to target exits."""
    def __init__(self, unique_id, model, pos, target):
        super().__init__(unique_id, model)
        self.pos = None
        self.target = target
        self.base_speed = 1.2 + random.uniform(-0.2, 0.2)  # meters per second
        self.speed = self.base_speed
        self.heading = (0, 0)
        self.path = None
        self.path_index = 0
        self.recalc_timer = random.randint(0, 10)  # staggered recalculation interval

    def recalculate_route(self):
        px, py = self.pos
        
        # Find best exit target with shortest A* path
        best_path = None
        best_exit = None
        min_cost = float('inf')

        # Check all available exits (including custom ones)
        exits = self.model.exits if len(self.model.exits) > 0 else [(95.0, 50.0)]
        for ex in exits:
            path = find_path_astar(px, py, ex[0], ex[1], self.model.obstacles, self.model.congested_cells)
            if path:
                cost = len(path)
                if cost < min_cost:
                    min_cost = cost
                    best_path = path
                    best_exit = ex

        if best_path:
            self.path = best_path
            self.path_index = 0
            self.target = best_exit
        else:
            # Fallback direct line routing to nearest exit if A* is blocked
            closest_exit = min(exits, key=lambda e: math.hypot(e[0] - px, e[1] - py))
            self.target = closest_exit
            self.path = [closest_exit]
            self.path_index = 0

    def step(self):
        px, py = self.pos
        
        # Periodic path recalculation or forced update when operators modify layout
        self.recalc_timer += 1
        if self.model.assets_updated or self.path is None or self.path_index >= len(self.path) or self.recalc_timer >= 12:
            self.recalculate_route()
            self.recalc_timer = 0

        # Target next node on path
        tx, ty = self.path[self.path_index]
        dx = tx - px
        dy = ty - py
        dist = math.hypot(dx, dy)

        # If reached path node, target next one
        if dist < 2.0:
            self.path_index += 1
            if self.path_index >= len(self.path):
                # Reached exit target safe zone, remove agent
                self.model.grid.remove_agent(self)
                self.model.schedule.remove(self)
                return
            tx, ty = self.path[self.path_index]
            dx = tx - px
            dy = ty - py
            dist = math.hypot(dx, dy)

        # Fundamental density slowdown mechanics
        neighbors = self.model.grid.get_neighbors(self.pos, radius=3.0, include_center=False)
        density = len(neighbors) / (math.pi * 3.0**2)
        if density > 0.1:
            speed_multiplier = max(0.05, 1.0 - (density / 1.5))
            self.speed = self.base_speed * speed_multiplier
        else:
            self.speed = self.base_speed

        # Heading vector
        if dist > 0.001:
            self.heading = (dx / dist, dy / dist)
        else:
            self.heading = (0, 0)
        
        # Next step calculation
        new_x = px + self.heading[0] * self.speed * self.model.dt
        new_y = py + self.heading[1] * self.speed * self.model.dt

        # Ensure inside venue bounds
        new_x = max(0.1, min(self.model.width - 0.1, new_x))
        new_y = max(0.1, min(self.model.height - 0.1, new_y))

        # Update position
        self.model.grid.move_agent(self, (new_x, new_y))

class VenueCrowdModel(Model):
    """Model simulating the venue with customizable entrances, exits, and obstacles."""
    def __init__(self, width=100, height=100, dt=1.0):
        super().__init__()
        self.width = width
        self.height = height
        self.dt = dt
        self.schedule = RandomActivation(self)
        self.grid = ContinuousSpace(width, height, torus=False)
        self.next_agent_id = 0
        self.surge_mode = False
        
        # Simulation settings synced from operator
        self.exits = [(95.0, 50.0)]
        self.entrances = [(5.0, 50.0), (5.0, 20.0), (5.0, 80.0)]
        self.obstacles = []  # list of {"x": x, "y": y, "radius": radius}
        self.congested_cells = []
        self.assets_updated = False

        # Pre-seed initial crowd agents across the venue
        for _ in range(35):
            spawn_pos = (random.uniform(5.0, 80.0), random.uniform(10.0, 90.0))
            target = random.choice(self.exits)
            agent = PedestrianAgent(self.next_agent_id, self, spawn_pos, target)
            self.next_agent_id += 1
            self.schedule.add(agent)
            self.grid.place_agent(agent, spawn_pos)

    def toggle_surge(self):
        self.surge_mode = not self.surge_mode
        return self.surge_mode

    def step(self):
        # Maintain a healthy active crowd population (25–50 agents)
        current_count = len(self.schedule.agents) if hasattr(self.schedule, "agents") else 0
        target_min = 45 if self.surge_mode else 25
        needed = max(0, target_min - current_count)
        spawn_rate = (5 if self.surge_mode else 2) + needed

        for _ in range(spawn_rate):
            if len(self.entrances) > 0:
                entrance = random.choice(self.entrances)
                spawn_pos = (entrance[0] + random.uniform(-2, 2), entrance[1] + random.uniform(-2, 2))
                spawn_pos = (max(0.1, min(self.width - 0.1, spawn_pos[0])), max(0.1, min(self.height - 0.1, spawn_pos[1])))
                
                exits = self.exits if len(self.exits) > 0 else [(95.0, 50.0)]
                target = random.choice(exits)
                
                agent = PedestrianAgent(self.next_agent_id, self, spawn_pos, target)
                self.next_agent_id += 1
                self.schedule.add(agent)
                self.grid.place_agent(agent, spawn_pos)

        # Advance model step
        self.schedule.step()
        
        # Reset assets updated flag at end of step
        if self.assets_updated:
            self.assets_updated = False

    def get_agent_positions(self):
        positions = []
        for agent in self.schedule.agents:
            positions.append({
                "id": agent.unique_id,
                "x": agent.pos[0],
                "y": agent.pos[1],
                "speed": agent.speed,
                "heading": agent.heading
            })
        return positions
